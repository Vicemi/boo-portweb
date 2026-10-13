"""Publishes a GitHub release with the Windows installer attached (the desktop version looks for it to offer updates).

usage: python tools/publish_release.py <version> [notes.md] [--replace]   (--replace deletes a release / tag of the same version first)
  - the version is the one of desktop/Cargo.toml ([workspace.package]) and the tag is v<version>
  - the notes (default: CHANGELOG.md, the section of that version) become the description of the release = the changelog the players see in the game
  - needs desktop/release/Boo-Instalador.exe (python tools/build_desktop.py) and the commit pushed to origin/main
The token is the one git already has for github.com (git credential); it is never printed."""
import json, os, re, subprocess, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'Vicemi/boo-portweb'


def token():
    p = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True, cwd=ROOT)
    for line in p.stdout.splitlines():
        if line.startswith('password='):
            return line[9:]
    sys.exit('no hay credenciales de github.com en git')


def api(method, url, tok, data=None, raw=None, ctype='application/json'):
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(url, data=body, method=method, headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'User-Agent': 'boo-release', 'Content-Type': ctype, 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        sys.exit('GitHub %s %s -> %s %s' % (method, url.split('?')[0], e.code, e.read().decode()[:400]))


def notes_for(version, path):
    text = open(path, encoding='utf-8').read()
    m = re.search(r'^## +v?%s\b.*?$(.*?)(?=^## |\Z)' % re.escape(version), text, re.S | re.M)
    return (m.group(1) if m else text).strip()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    version = args[0].lstrip('v')
    notes = notes_for(version, os.path.join(ROOT, args[1] if len(args) > 1 else 'CHANGELOG.md'))
    exe = os.path.join(ROOT, 'desktop', 'release', 'Boo-Instalador.exe')
    if not os.path.exists(exe):
        sys.exit('falta ' + exe)
    tok = token()
    tag = 'v' + version
    if '--replace' in sys.argv:
        # a release of the same version that was published before (and the tag) are deleted first
        try:
            old = api('GET', 'https://api.github.com/repos/%s/releases/tags/%s' % (REPO, tag), tok)
            api('DELETE', 'https://api.github.com/repos/%s/releases/%d' % (REPO, old['id']), tok)
            print('deleted the old release', tag)
        except SystemExit:
            pass
        try:
            api('DELETE', 'https://api.github.com/repos/%s/git/refs/tags/%s' % (REPO, tag), tok)
        except SystemExit:
            pass
    rel = api('POST', 'https://api.github.com/repos/%s/releases' % REPO, tok, {'tag_name': tag, 'target_commitish': 'main', 'name': 'Boo %s' % version, 'body': notes, 'draft': False, 'prerelease': False})
    print('release', rel['html_url'])
    name = 'Boo-Instalador-%s.exe' % version
    url = rel['upload_url'].split('{')[0] + '?name=' + name
    asset = api('POST', url, tok, raw=open(exe, 'rb').read(), ctype='application/octet-stream')
    print('asset', asset['name'], asset['size'] // 1024, 'KB', asset['browser_download_url'])


if __name__ == '__main__':
    main()
