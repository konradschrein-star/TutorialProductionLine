@echo off
:: Disconnects RDP session and redirects GUI context to the local physical console
:: This keeps GPU rendering, audio synthesis, OCR, and uploader scripts active headless.
for /f "skip=1 tokens=3" %%s in ('query user %USERNAME%') do %windir%\System32\tscon.exe %%s /dest:console
