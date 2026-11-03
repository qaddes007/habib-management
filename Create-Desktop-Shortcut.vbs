Set oWS = WScript.CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

Dim userProf
userProf = oWS.ExpandEnvironmentStrings("%USERPROFILE%")

Dim paths(2)
paths(0) = oWS.SpecialFolders("Desktop")
paths(1) = userProf & "\OneDrive\Desktop"
paths(2) = userProf & "\Desktop"

Dim iconPath
iconPath = currentDir & "\assets\app-icon.ico"

For Each d In paths
    If fso.FolderExists(d) Then
        Dim sLinkFile, oLink
        sLinkFile = d & "\S. HABIB STEEL.lnk"

        If fso.FileExists(sLinkFile) Then
            fso.DeleteFile sLinkFile, True
        End If

        Set oLink = oWS.CreateShortcut(sLinkFile)
        oLink.TargetPath = currentDir & "\launch.vbs"
        oLink.WorkingDirectory = currentDir
        oLink.Description = "S. HABIB STEEL & LASER CRAFT Management System"
        oLink.IconLocation = iconPath & ",0"
        oLink.Save
    End If
Next

If InStr(LCase(WScript.FullName), "cscript") = 0 Then
    MsgBox "Desktop shortcut created successfully on your Desktop!" & vbCrLf & vbCrLf & "Look for 'S. HABIB STEEL' on your Desktop.", vbInformation, "S. HABIB STEEL & LASER CRAFT"
End If
