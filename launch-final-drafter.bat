@echo off
setlocal

set DIR=%~dp0
set PAGE=%DIR%empty.html

set CHROME=
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P set CHROME=%%P
)

if defined CHROME (
    start "" %CHROME% --app="file:///%PAGE:\=/%"
) else (
    start "" "%PAGE%"
)

endlocal
