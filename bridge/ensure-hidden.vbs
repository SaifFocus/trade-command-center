' The bridge's 10-minute check, with no window: starts the bridge unless a healthy one is running.
' Task Scheduler runs this every 10 minutes (install-autostart.cmd sets that up).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
node = "node"
pf = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(pf) Then node = """" & pf & """"
sh.Run "cmd /c " & node & " bridge.mjs --ensure >> bridge-console.log 2>&1", 0, False
