' Starts the APEX Invo Bridge with no window. Output goes to bridge.log in this folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
node = "node"
pf = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(pf) Then node = """" & pf & """"
sh.Run "cmd /c " & node & " bridge.mjs >> bridge-console.log 2>&1", 0, False
