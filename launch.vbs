Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir
WshShell.Run """" & currentDir & "\frontend\node_modules\electron\dist\electron.exe"" """ & currentDir & "\electron-main.cjs""", 0, False

