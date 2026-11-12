; The app was called tlansclaib, and its installer registered under that name, so this one would install beside it.
; Its uninstaller runs in place and silently, which keeps the app data the new app moves over on its first start.
!macro NSIS_HOOK_PREINSTALL
  Var /GLOBAL FormerDir
  Var /GLOBAL FormerQuote
  ReadRegStr $FormerDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\tlansclaib" "InstallLocation"
  ${If} $FormerDir != ""
    StrCpy $FormerQuote $FormerDir 1
    ${If} $FormerQuote == '"'
      StrCpy $FormerDir $FormerDir "" 1
      StrCpy $FormerDir $FormerDir -1
    ${EndIf}
    ExecWait '"$FormerDir\uninstall.exe" /S _?=$FormerDir'
    Delete "$FormerDir\uninstall.exe"
    RMDir "$FormerDir"
  ${EndIf}
!macroend
