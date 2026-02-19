' Voice Mirror - Dev launcher for Windows
' Launches "npm run dev" (tauri dev) in Windows Terminal.
' Used by the desktop shortcut.

Set shell = CreateObject("WScript.Shell")
shell.Run """C:\Users\georg\AppData\Local\Microsoft\WindowsApps\wt.exe"" -d ""E:\Projects\Voice Mirror"" cmd /k ""npm run dev""", 1, False
