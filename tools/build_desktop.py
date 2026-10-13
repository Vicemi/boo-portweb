"""Builds the offline desktop version (Rust): the web build (dist/), the player (desktop/player -> boo.exe), the payload (boo.exe + game/) and the
installer (desktop/installer) that carries the payload. The result: desktop/release/Boo-Instalador.exe  (run: python tools/build_desktop.py)"""
import os, shutil, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'desktop')


def run(cmd, cwd):
    print('>', ' '.join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=(os.name == 'nt' and cmd[0] == 'npm'))


def main():
    if '--skip-web' not in sys.argv:
        run(['npm', 'run', 'build'], ROOT)
    run(['cargo', 'build', '--release', '-p', 'boo-player'], D)
    payload = os.path.join(D, 'payload')
    os.makedirs(payload, exist_ok=True)
    zpath = os.path.join(payload, 'payload.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.write(os.path.join(D, 'target', 'release', 'boo.exe'), 'boo.exe')
        dist = os.path.join(ROOT, 'dist')
        for base, _, files in os.walk(dist):
            for f in files:
                full = os.path.join(base, f)
                z.write(full, 'game/' + os.path.relpath(full, dist).replace(os.sep, '/'))
    print('payload', os.path.getsize(zpath) // 1024, 'KB')
    # the uninstaller: the same program without the game inside (built in its own target folder)
    env_target = os.path.join(D, 'target-stub')
    print('> cargo build (uninstaller)')
    subprocess.run(['cargo', 'build', '--release', '-p', 'boo-installer', '--features', 'stub'], cwd=D, check=True, env=dict(os.environ, CARGO_TARGET_DIR=env_target))
    shutil.copyfile(os.path.join(env_target, 'release', 'boo-installer.exe'), os.path.join(payload, 'uninstall.exe'))
    run(['cargo', 'build', '--release', '-p', 'boo-installer'], D)
    out = os.path.join(D, 'release')
    os.makedirs(out, exist_ok=True)
    shutil.copyfile(os.path.join(D, 'target', 'release', 'boo-installer.exe'), os.path.join(out, 'Boo-Instalador.exe'))
    print('done:', os.path.join(out, 'Boo-Instalador.exe'), os.path.getsize(os.path.join(out, 'Boo-Instalador.exe')) // 1024, 'KB')


if __name__ == '__main__':
    main()
