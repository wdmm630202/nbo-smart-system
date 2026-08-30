import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scripts = {
  file: 'POSIX path of (choose file with prompt "选择要加入南铂工作台的素材")',
  folder: 'POSIX path of (choose folder with prompt "选择要加入南铂工作台的素材文件夹")',
};

export async function selectLocalPath({ kind, run = execFileAsync }) {
  if (!Object.hasOwn(scripts, kind)) throw new Error("选择类型只能是 file 或 folder");
  try {
    const { stdout } = await run("osascript", ["-e", scripts[kind]], { maxBuffer: 1024 * 1024 });
    const selected = String(stdout || "").trim();
    if (!selected) return null;
    if (!isAbsolute(selected)) throw new Error("选择器返回了无效路径");
    return selected;
  } catch (error) {
    if (error?.code === 1 || /User canceled|用户已取消|-128/.test(String(error?.stderr || error?.message || ""))) return null;
    throw error;
  }
}
