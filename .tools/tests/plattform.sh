# .tools/tests/plattform.sh — von jedem Shell-Test als Erstes gesourct.
# Unter Windows (Git Bash) versteht Node keine POSIX-Pfade: aus /tmp/x oder /d/a/… macht es D:\tmp\x bzw.
# D:\d\a\… — sobald ein Pfad in einem String steckt (node -e, JSON), den Git Bash nicht umschreibt.
# Darum liefern pwd und mktemp hier die gemischte Form C:/…, die Bash UND Node verstehen.
# Node liest das Home-Verzeichnis unter Windows aus USERPROFILE, nicht aus HOME — Tests mit eigenem
# Home setzen deshalb beides. Auf macOS/Linux tut diese Datei nichts.
# Tests legen eigene Temp-Repos an: geerbte GIT_*-Variablen (z. B. aus einem Hook) würden sie aufs echte Repo lenken.
for _v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$_v"; done; unset _v
TEST_WIN=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    TEST_WIN=1
    pwd() { builtin pwd -W; }
    mktemp() { local p; p="$(command mktemp "$@")" || return 1; cygpath -ml "$p"; }
    ;;
esac
# PATH-Einträge brauchen unter Git Bash die POSIX-Form (/c/…): in "C:/…" wäre der Doppelpunkt ein Trenner.
posixpfad() { if [ "$TEST_WIN" = 1 ]; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
