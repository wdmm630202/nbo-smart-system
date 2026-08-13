#!/bin/bash

set -u

if [ "$#" -ne 1 ]; then
  echo "用法：classify.sh 文件夹路径" >&2
  exit 64
fi

target_folder=$1
progress_file=${PHOTO_SORTER_PROGRESS_FILE:-}
progress_total=1
progress_done=0

if [ ! -d "$target_folder" ]; then
  echo "当前 Finder 位置不是可处理的本地文件夹：$target_folder" >&2
  exit 66
fi

cr2_count=0
cr3_count=0
jpg_count=0
video_4k_count=0
video_3k_count=0
video_2k_count=0
unrecognized_video_count=0
other_count=0
move_error_count=0
moved_count=0
rename_error_count=0
renamed_folder_count=0

cr2_start_epoch=""
cr2_end_epoch=""
cr3_start_epoch=""
cr3_end_epoch=""
jpg_start_epoch=""
jpg_end_epoch=""
cr2_bytes=0
cr3_bytes=0
jpg_bytes=0
renamed_folder_names=()

write_progress() {
  local percent message
  percent=$1
  message=$2
  [ -n "$progress_file" ] || return 0
  printf '%s|%s\n' "$percent" "$message" > "$progress_file"
}

advance_progress() {
  local message percent
  message=$1
  progress_done=$((progress_done + 1))
  percent=$((5 + progress_done * 90 / progress_total))
  [ "$percent" -le 95 ] || percent=95
  write_progress "$percent" "$message"
}

file_extension() {
  local filename extension
  filename=${1##*/}
  if [[ "$filename" != *.* ]] || [[ "$filename" == .* && "$filename" != *.*.* ]]; then
    printf '%s' ""
    return
  fi
  extension=${filename##*.}
  printf '%s' "$extension" | /usr/bin/tr '[:upper:]' '[:lower:]'
}

parse_metadata_date() {
  local raw_date cleaned_date epoch
  raw_date=$1
  [ -n "$raw_date" ] || return 1
  [ "$raw_date" != "(null)" ] || return 1

  cleaned_date=${raw_date#\"}
  cleaned_date=${cleaned_date%\"}
  cleaned_date=$(printf '%s' "$cleaned_date" | /usr/bin/sed -E 's/\.[0-9]+ ([+-][0-9]{4})$/ \1/')
  epoch=$(/bin/date -j -f '%Y-%m-%d %H:%M:%S %z' "$cleaned_date" '+%s' 2>/dev/null || true)

  [[ "$epoch" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$epoch"
}

photo_capture_epoch() {
  local file sips_date metadata_date metadata epoch
  file=$1

  sips_date=$(/usr/bin/sips -g creation "$file" 2>/dev/null | /usr/bin/awk '$1 == "creation:" { print $2 " " $3; exit }')
  epoch=$(/bin/date -j -f '%Y:%m:%d %H:%M:%S' "$sips_date" '+%s' 2>/dev/null || true)
  if [[ "$epoch" =~ ^[0-9]+$ ]]; then
    printf '%s' "$epoch"
    return 0
  fi

  metadata=$(/usr/bin/mdimport -t -d3 "$file" </dev/null 2>&1 || true)
  metadata_date=$(printf '%s\n' "$metadata" | /usr/bin/sed -n 's/^[[:space:]]*kMDItemContentCreationDate = "\(.*\)";$/\1/p' | /usr/bin/head -n 1)
  epoch=$(parse_metadata_date "$metadata_date") || true
  if [[ "$epoch" =~ ^[0-9]+$ ]]; then
    printf '%s' "$epoch"
    return 0
  fi

  metadata_date=$(/usr/bin/mdls -raw -name kMDItemContentCreationDate -- "$file" 2>/dev/null || true)
  epoch=$(parse_metadata_date "$metadata_date") || true
  if [[ "$epoch" =~ ^[0-9]+$ ]]; then
    printf '%s' "$epoch"
    return 0
  fi

  epoch=$(/usr/bin/stat -f '%m' "$file" 2>/dev/null || true)
  if [[ "$epoch" =~ ^[0-9]+$ ]]; then
    printf '%s' "$epoch"
    return 0
  fi

  return 1
}

format_capture_time() {
  /bin/date -r "$1" '+%H时%M分'
}

format_capture_date() {
  /bin/date -r "$1" '+%y.%m.%d' | /usr/bin/sed -E 's/\.0([0-9])/\.\1/g'
}

capture_duration_minutes() {
  local start_minute end_minute duration
  start_minute=$(($1 / 60))
  end_minute=$(($2 / 60))
  duration=$((end_minute - start_minute))
  [ "$duration" -ge 0 ] || duration=0
  printf '%s' "$duration"
}

file_size_bytes() {
  /usr/bin/stat -f '%z' "$1" 2>/dev/null || printf '%s' 0
}

format_file_size_g() {
  /usr/bin/awk -v bytes="$1" 'BEGIN { printf "%.1fG", bytes / 1000000000 }'
}

photo_folder_name_from_values() {
  local format start_epoch end_epoch count total_bytes date_label start_label end_label duration size_label
  format=$1
  start_epoch=$2
  end_epoch=$3
  count=$4
  total_bytes=$5
  size_label=$(format_file_size_g "$total_bytes")

  if [ -z "$start_epoch" ] || [ -z "$end_epoch" ]; then
    printf '%s' "$format-日期未知(时间未知-时间未知*共计0分钟拍摄)-${count}张*共$size_label"
    return
  fi

  date_label=$(format_capture_date "$start_epoch")
  start_label=$(format_capture_time "$start_epoch")
  end_label=$(format_capture_time "$end_epoch")
  duration=$(capture_duration_minutes "$start_epoch" "$end_epoch")
  printf '%s' "$format-$date_label($start_label-$end_label*共计${duration}分钟拍摄)-${count}张*共$size_label"
}

update_category_time() {
  local category epoch
  category=$1
  epoch=$2

  case "$category" in
    cr2)
      if [ -z "$cr2_start_epoch" ] || [ "$epoch" -lt "$cr2_start_epoch" ]; then cr2_start_epoch=$epoch; fi
      if [ -z "$cr2_end_epoch" ] || [ "$epoch" -gt "$cr2_end_epoch" ]; then cr2_end_epoch=$epoch; fi
      ;;
    cr3)
      if [ -z "$cr3_start_epoch" ] || [ "$epoch" -lt "$cr3_start_epoch" ]; then cr3_start_epoch=$epoch; fi
      if [ -z "$cr3_end_epoch" ] || [ "$epoch" -gt "$cr3_end_epoch" ]; then cr3_end_epoch=$epoch; fi
      ;;
    jpg)
      if [ -z "$jpg_start_epoch" ] || [ "$epoch" -lt "$jpg_start_epoch" ]; then jpg_start_epoch=$epoch; fi
      if [ -z "$jpg_end_epoch" ] || [ "$epoch" -gt "$jpg_end_epoch" ]; then jpg_end_epoch=$epoch; fi
      ;;
  esac
}

photo_folder_name_for_category() {
  local category start_epoch end_epoch count total_bytes
  category=$1
  start_epoch=""
  end_epoch=""
  count=0
  total_bytes=0

  case "$category" in
    cr2) start_epoch=$cr2_start_epoch; end_epoch=$cr2_end_epoch; count=$cr2_count; total_bytes=$cr2_bytes ;;
    cr3) start_epoch=$cr3_start_epoch; end_epoch=$cr3_end_epoch; count=$cr3_count; total_bytes=$cr3_bytes ;;
    jpg) start_epoch=$jpg_start_epoch; end_epoch=$jpg_end_epoch; count=$jpg_count; total_bytes=$jpg_bytes ;;
  esac

  photo_folder_name_from_values "$category" "$start_epoch" "$end_epoch" "$count" "$total_bytes"
}

is_video_extension() {
  case "$1" in
    mov|mp4|m4v|avi|mts|m2ts|mpg|mpeg|mkv|3gp|3g2|wmv|webm)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

read_video_dimensions() {
  local file width height metadata
  file=$1
  width=$(/usr/bin/mdls -raw -name kMDItemPixelWidth -- "$file" 2>/dev/null || true)
  height=$(/usr/bin/mdls -raw -name kMDItemPixelHeight -- "$file" 2>/dev/null || true)

  if [[ "$width" =~ ^[0-9]+$ ]] && [[ "$height" =~ ^[0-9]+$ ]]; then
    printf '%s %s' "$width" "$height"
    return 0
  fi

  metadata=$(/usr/bin/mdimport -t -d3 "$file" </dev/null 2>&1 || true)
  width=$(printf '%s\n' "$metadata" | /usr/bin/awk '$1 == "kMDItemPixelWidth" && $2 == "=" { gsub(/;/, "", $3); print $3; exit }')
  height=$(printf '%s\n' "$metadata" | /usr/bin/awk '$1 == "kMDItemPixelHeight" && $2 == "=" { gsub(/;/, "", $3); print $3; exit }')

  if [[ "$width" =~ ^[0-9]+$ ]] && [[ "$height" =~ ^[0-9]+$ ]]; then
    printf '%s %s' "$width" "$height"
    return 0
  fi

  return 1
}

video_category() {
  local file dimensions width height longest
  file=$1
  dimensions=$(read_video_dimensions "$file") || return 1
  width=${dimensions%% *}
  height=${dimensions##* }

  if [ "$width" -ge "$height" ]; then
    longest=$width
  else
    longest=$height
  fi

  if [ "$longest" -ge 3840 ]; then
    printf '%s' "4k"
  elif [ "$longest" -ge 2880 ]; then
    printf '%s' "3k"
  elif [ "$longest" -ge 1920 ]; then
    printf '%s' "2k"
  else
    return 1
  fi
}

category_for_file() {
  local file extension resolution
  file=$1
  extension=$(file_extension "$file")

  case "$extension" in
    cr2)
      printf '%s' "cr2"
      ;;
    cr3)
      printf '%s' "cr3"
      ;;
    jpg|jpeg)
      printf '%s' "jpg"
      ;;
    *)
      if is_video_extension "$extension"; then
        resolution=$(video_category "$file") || {
          printf '%s' "video-unrecognized"
          return
        }
        printf '%s' "$resolution"
      else
        printf '%s' "other"
      fi
      ;;
  esac
}

initialize_progress() {
  local root_file_count legacy_photo_count folder folder_name format file extension
  root_file_count=0
  legacy_photo_count=0

  while IFS= read -r -d '' file; do
    root_file_count=$((root_file_count + 1))
  done < <(/usr/bin/find "$target_folder" -mindepth 1 -maxdepth 1 -type f ! -name '.DS_Store' -print0)

  while IFS= read -r -d '' folder; do
    folder_name=${folder##*/}
    if [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张\*文件大小[0-9]+\.[0-9]G$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张\*共\*[0-9]+\.[0-9]G$ ]]; then
      format=${BASH_REMATCH[1]}
    else
      continue
    fi

    while IFS= read -r -d '' file; do
      extension=$(file_extension "$file")
      case "$format:$extension" in
        cr2:cr2|cr3:cr3|jpg:jpg|jpg:jpeg)
          legacy_photo_count=$((legacy_photo_count + 1))
          ;;
      esac
    done < <(/usr/bin/find "$folder" -mindepth 1 -maxdepth 1 -type f ! -name '.DS_Store' -print0)
  done < <(/usr/bin/find "$target_folder" -mindepth 1 -maxdepth 1 -type d -print0)

  progress_total=$((root_file_count * 2 + legacy_photo_count))
  [ "$progress_total" -gt 0 ] || progress_total=1
  write_progress 5 "正在准备并统计文件数量…"
}

rename_legacy_photo_folders() {
  local folder folder_name format extension file count epoch start_epoch end_epoch total_bytes file_bytes
  local destination suffix

  while IFS= read -r -d '' folder; do
    folder_name=${folder##*/}
    if [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张\*文件大小[0-9]+\.[0-9]G$ ]] || \
       [[ "$folder_name" =~ ^(cr2|cr3|jpg)-[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}\([0-9]{2}时[0-9]{2}分-[0-9]{2}时[0-9]{2}分\*共计[0-9]+分钟拍摄\)-[0-9]+张\*共\*[0-9]+\.[0-9]G$ ]]; then
      format=${BASH_REMATCH[1]}
    else
      continue
    fi

    count=0
    start_epoch=""
    end_epoch=""
    total_bytes=0

    while IFS= read -r -d '' file; do
      extension=$(file_extension "$file")
      case "$format:$extension" in
        cr2:cr2|cr3:cr3|jpg:jpg|jpg:jpeg) ;;
        *) continue ;;
      esac

      count=$((count + 1))
      file_bytes=$(file_size_bytes "$file")
      total_bytes=$((total_bytes + file_bytes))
      epoch=$(photo_capture_epoch "$file") || epoch=""
      if [ -n "$epoch" ]; then
        if [ -z "$start_epoch" ] || [ "$epoch" -lt "$start_epoch" ]; then start_epoch=$epoch; fi
        if [ -z "$end_epoch" ] || [ "$epoch" -gt "$end_epoch" ]; then end_epoch=$epoch; fi
      fi
      advance_progress "正在读取已有照片的拍摄时间…"
    done < <(/usr/bin/find "$folder" -mindepth 1 -maxdepth 1 -type f ! -name '.DS_Store' -print0)

    [ "$count" -gt 0 ] || continue
    destination="$target_folder/$(photo_folder_name_from_values "$format" "$start_epoch" "$end_epoch" "$count" "$total_bytes")"
    if [ -e "$destination" ]; then
      suffix=2
      while [ -e "$destination-$suffix" ]; do suffix=$((suffix + 1)); done
      destination="$destination-$suffix"
    fi

    if /bin/mv -- "$folder" "$destination"; then
      renamed_folder_names[${#renamed_folder_names[@]}]=${destination##*/}
      renamed_folder_count=$((renamed_folder_count + 1))
    else
      rename_error_count=$((rename_error_count + 1))
    fi
  done < <(/usr/bin/find "$target_folder" -mindepth 1 -maxdepth 1 -type d -print0)
}

initialize_progress
rename_legacy_photo_folders

files=()
categories=()

while IFS= read -r -d '' file; do
  category=$(category_for_file "$file")
  files[${#files[@]}]=$file
  categories[${#categories[@]}]=$category
  case "$category" in
    cr2)
      cr2_count=$((cr2_count + 1))
      file_bytes=$(file_size_bytes "$file")
      cr2_bytes=$((cr2_bytes + file_bytes))
      epoch=$(photo_capture_epoch "$file") || epoch=""
      [ -z "$epoch" ] || update_category_time cr2 "$epoch"
      ;;
    cr3)
      cr3_count=$((cr3_count + 1))
      file_bytes=$(file_size_bytes "$file")
      cr3_bytes=$((cr3_bytes + file_bytes))
      epoch=$(photo_capture_epoch "$file") || epoch=""
      [ -z "$epoch" ] || update_category_time cr3 "$epoch"
      ;;
    jpg)
      jpg_count=$((jpg_count + 1))
      file_bytes=$(file_size_bytes "$file")
      jpg_bytes=$((jpg_bytes + file_bytes))
      epoch=$(photo_capture_epoch "$file") || epoch=""
      [ -z "$epoch" ] || update_category_time jpg "$epoch"
      ;;
    4k) video_4k_count=$((video_4k_count + 1)) ;;
    3k) video_3k_count=$((video_3k_count + 1)) ;;
    2k) video_2k_count=$((video_2k_count + 1)) ;;
    video-unrecognized) unrecognized_video_count=$((unrecognized_video_count + 1)) ;;
    other) other_count=$((other_count + 1)) ;;
  esac
  advance_progress "正在读取照片和视频信息…"
done < <(/usr/bin/find "$target_folder" -mindepth 1 -maxdepth 1 -type f ! -name '.DS_Store' -print0)

folder_for_category() {
  case "$1" in
    cr2) printf '%s/%s' "$target_folder" "$(photo_folder_name_for_category cr2)" ;;
    cr3) printf '%s/%s' "$target_folder" "$(photo_folder_name_for_category cr3)" ;;
    jpg) printf '%s/%s' "$target_folder" "$(photo_folder_name_for_category jpg)" ;;
    4k) printf '%s/4k-%s条' "$target_folder" "$video_4k_count" ;;
    3k) printf '%s/3k-%s条' "$target_folder" "$video_3k_count" ;;
    2k) printf '%s/2k-%s条' "$target_folder" "$video_2k_count" ;;
  esac
}

ensure_category_folder() {
  local category folder suffix
  category=$1
  folder=$(folder_for_category "$category")

  if [ -d "$folder" ]; then
    printf '%s' "$folder"
    return 0
  fi

  if [ ! -e "$folder" ]; then
    /bin/mkdir -- "$folder" || return 1
    printf '%s' "$folder"
    return 0
  fi

  suffix=2
  while [ -e "$folder-$suffix" ]; do
    suffix=$((suffix + 1))
  done
  folder="$folder-$suffix"
  /bin/mkdir -- "$folder" || return 1
  printf '%s' "$folder"
}

safe_move() {
  local source destination_folder filename stem extension candidate suffix
  source=$1
  destination_folder=$2
  filename=${source##*/}
  candidate="$destination_folder/$filename"

  if [ ! -e "$candidate" ]; then
    /bin/mv -- "$source" "$candidate"
    return $?
  fi

  if [[ "$filename" == *.* ]] && [[ "$filename" != .* ]]; then
    stem=${filename%.*}
    extension=.${filename##*.}
  else
    stem=$filename
    extension=""
  fi

  suffix=2
  candidate="$destination_folder/${stem}-$suffix$extension"
  while [ -e "$candidate" ]; do
    suffix=$((suffix + 1))
    candidate="$destination_folder/${stem}-$suffix$extension"
  done
  /bin/mv -- "$source" "$candidate"
}

cr2_folder=""
cr3_folder=""
jpg_folder=""
video_4k_folder=""
video_3k_folder=""
video_2k_folder=""

[ "$cr2_count" -eq 0 ] || cr2_folder=$(ensure_category_folder cr2)
[ "$cr3_count" -eq 0 ] || cr3_folder=$(ensure_category_folder cr3)
[ "$jpg_count" -eq 0 ] || jpg_folder=$(ensure_category_folder jpg)
[ "$video_4k_count" -eq 0 ] || video_4k_folder=$(ensure_category_folder 4k)
[ "$video_3k_count" -eq 0 ] || video_3k_folder=$(ensure_category_folder 3k)
[ "$video_2k_count" -eq 0 ] || video_2k_folder=$(ensure_category_folder 2k)

file_index=0
while [ "$file_index" -lt "${#files[@]}" ]; do
  file=${files[$file_index]}
  category=${categories[$file_index]}
  destination_folder=""
  case "$category" in
    cr2) destination_folder=$cr2_folder ;;
    cr3) destination_folder=$cr3_folder ;;
    jpg) destination_folder=$jpg_folder ;;
    4k) destination_folder=$video_4k_folder ;;
    3k) destination_folder=$video_3k_folder ;;
    2k) destination_folder=$video_2k_folder ;;
  esac

  if [ -n "$destination_folder" ]; then
    if safe_move "$file" "$destination_folder"; then
      moved_count=$((moved_count + 1))
    else
      move_error_count=$((move_error_count + 1))
    fi
  fi
  advance_progress "正在建立文件夹并移动分类…"
  file_index=$((file_index + 1))
done

if [ "$moved_count" -eq 0 ] && [ "$unrecognized_video_count" -eq 0 ] && [ "$renamed_folder_count" -eq 0 ]; then
  write_progress 100 "检查完成，没有需要处理的文件。"
  echo "当前文件夹没有需要分类的 CR2、CR3、JPG 或 2K/3K/4K 视频。"
  exit 0
fi

if [ "$moved_count" -gt 0 ] || [ "$unrecognized_video_count" -gt 0 ]; then
  echo "分类完成：已移动 $moved_count 个文件。"
  [ "$cr2_count" -eq 0 ] || echo "${cr2_folder##*/}"
  [ "$cr3_count" -eq 0 ] || echo "${cr3_folder##*/}"
  [ "$jpg_count" -eq 0 ] || echo "${jpg_folder##*/}"
  [ "$video_4k_count" -eq 0 ] || echo "${video_4k_folder##*/}"
  [ "$video_3k_count" -eq 0 ] || echo "${video_3k_folder##*/}"
  [ "$video_2k_count" -eq 0 ] || echo "${video_2k_folder##*/}"

  if [ "$video_4k_count" -eq 0 ] && [ "$video_3k_count" -eq 0 ] && [ "$video_2k_count" -eq 0 ]; then
    echo "没有识别到 2K/3K/4K 视频，未建立视频文件夹。"
  fi
  [ "$unrecognized_video_count" -eq 0 ] || echo "另有 $unrecognized_video_count 条低于 2K 或无法读取的视频保留在原处。"
  [ "$other_count" -eq 0 ] || echo "其他 $other_count 个文件保持原位。"
  [ "$move_error_count" -eq 0 ] || echo "有 $move_error_count 个文件移动失败，请检查权限或磁盘状态。"
fi

if [ "$renamed_folder_count" -gt 0 ]; then
  echo "命名完成：已为 $renamed_folder_count 个旧照片文件夹补全拍摄信息和文件大小。"
  folder_index=0
  while [ "$folder_index" -lt "${#renamed_folder_names[@]}" ]; do
    echo "${renamed_folder_names[$folder_index]}"
    folder_index=$((folder_index + 1))
  done
fi
[ "$rename_error_count" -eq 0 ] || echo "有 $rename_error_count 个旧照片文件夹改名失败，请检查权限。"
write_progress 100 "分类与命名已经完成。"
