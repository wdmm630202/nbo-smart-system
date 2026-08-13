use scripting additions

property sorterRunning : false
property workerPID : ""
property activeWorkDir : ""

on run
	if sorterRunning then
		activate
		return
	end if
	
	set sorterRunning to true
	set workerPID to ""
	set activeWorkDir to ""
	
	try
		tell application "Finder"
			if (count of Finder windows) is 0 then error "请先打开一个普通文件夹窗口。"
			set currentFolder to POSIX path of (target of front Finder window as alias)
		end tell
		
		set progress total steps to 100
		set progress completed steps to 1
		set progress description to "照片视频正在分类"
		set progress additional description to "正在启动，请稍候…"
		
		set helperPath to POSIX path of (path to resource "classify.sh")
		set activeWorkDir to do shell script "/usr/bin/mktemp -d /tmp/photo-video-sorter-ui.XXXXXX"
		set statusPath to activeWorkDir & "/progress.txt"
		set resultPath to activeWorkDir & "/result.txt"
		set errorPath to activeWorkDir & "/error.txt"
		set exitPath to activeWorkDir & "/exit.txt"
		
		do shell script "/bin/echo " & quoted form of "1|正在启动并检查文件…" & " > " & quoted form of statusPath
		set workerCommand to "PHOTO_SORTER_PROGRESS_FILE=" & quoted form of statusPath & space & quoted form of helperPath & space & quoted form of currentFolder & " > " & quoted form of resultPath & " 2> " & quoted form of errorPath & "; result_code=$?; /bin/echo $result_code > " & quoted form of exitPath
		set workerPID to do shell script "/bin/sh -c " & quoted form of ("(" & workerCommand & ") & /bin/echo $!")
		
		repeat
			try
				set statusText to do shell script "/bin/cat " & quoted form of statusPath & " 2>/dev/null || true"
				if statusText is not "" then my updateProgress(statusText)
			end try
			
			set isFinished to do shell script "if [ -f " & quoted form of exitPath & " ]; then /bin/echo yes; else /bin/echo no; fi"
			if isFinished is "yes" then exit repeat
			delay 0.2
		end repeat
		
		set exitCode to do shell script "/bin/cat " & quoted form of exitPath
		if exitCode is not "0" then
			set errorText to do shell script "/bin/cat " & quoted form of errorPath & " 2>/dev/null || true"
			if errorText is "" then set errorText to "处理失败，请检查文件夹权限或磁盘状态。"
			error errorText number 1
		end if
		
		set resultText to do shell script "/bin/cat " & quoted form of resultPath
		set progress completed steps to 100
		set progress additional description to "已经完成。"
		delay 0.2
		
		my resetProgress()
		my cleanupWorkDir()
		set workerPID to ""
		set sorterRunning to false
		
		activate
		display dialog resultText with title "照片视频一键分类" buttons {"完成"} default button "完成" with icon note
	on error errorMessage number errorNumber
		if workerPID is not "" then
			do shell script "/usr/bin/pkill -TERM -P " & workerPID & " 2>/dev/null || true; /bin/kill -TERM " & workerPID & " 2>/dev/null || true"
		end if
		my resetProgress()
		my cleanupWorkDir()
		set workerPID to ""
		set sorterRunning to false
		
		if errorNumber is -128 then return
		activate
		display alert "分类没有执行" message errorMessage as critical buttons {"知道了"} default button "知道了"
	end try
end run

on reopen
	activate
end reopen

on updateProgress(statusText)
	set previousDelimiters to AppleScript's text item delimiters
	try
		set AppleScript's text item delimiters to "|"
		set statusParts to text items of statusText
		if (count of statusParts) > 1 then
			set completedValue to item 1 of statusParts as integer
			set detailText to item 2 of statusParts
			set progress completed steps to completedValue
			set progress additional description to detailText
		end if
	on error
		-- A partially written status line is ignored and retried on the next poll.
	end try
	set AppleScript's text item delimiters to previousDelimiters
end updateProgress

on resetProgress()
	set progress total steps to 0
	set progress completed steps to 0
	set progress description to ""
	set progress additional description to ""
end resetProgress

on cleanupWorkDir()
	if activeWorkDir is not "" then
		do shell script "/usr/bin/find " & quoted form of activeWorkDir & " -depth -delete 2>/dev/null || true"
	end if
	set activeWorkDir to ""
end cleanupWorkDir


