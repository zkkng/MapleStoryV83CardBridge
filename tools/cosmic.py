#!/usr/bin/env python3
"""Prepare, build, start and operate a complete Cosmic card installation."""
from pathlib import Path
import argparse
import base64
import getpass
import hashlib
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "deployment/cosmic"
RUNTIME = json.loads((TEMPLATES / "runtime.json").read_text(encoding="utf-8"))


def run(command, *, cwd=None, data=None, capture=False):
    result = subprocess.run(
        command,
        cwd=cwd,
        input=data,
        capture_output=True,
        text=isinstance(data, str) or data is None,
    )
    if result.returncode:
        # Account input, SQL output and generated configuration never enter diagnostics.
        if command[:2] == ["docker", "build"] or "build" in command:
            sys.stderr.write(
                result.stderr.decode()
                if isinstance(result.stderr, bytes)
                else result.stderr
            )
        raise RuntimeError(
            "Command failed: " + command[0] + ". Inspect the service or build logs."
        )
    if capture:
        return result.stdout
    return result


def private_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError("Configuration paths must not be symbolic links.")
    if path.exists():
        path.chmod(0o600)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data.encode() if isinstance(data, str) else data)
        stream.flush()
        os.fsync(stream.fileno())


def load(directory):
    directory = Path(directory).resolve()
    data = json.loads((directory / "installation.json").read_text(encoding="utf-8"))
    if data.get("format") != 1 or data.get("directory") != str(directory):
        raise RuntimeError("This is not the original managed installation directory.")
    return directory, data


def compose(directory, *args, data=None, capture=False):
    return run(
        ["docker", "compose", "-f", str(directory / "compose.json"), *args],
        cwd=directory,
        data=data,
        capture=capture,
    )


def prerequisites():
    if os.name != "posix":
        raise RuntimeError(
            "Run the managed installer on Linux, or inside WSL2 with Docker integration enabled."
        )
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11 or newer is required.")
    for tool in ["git", "docker"]:
        if not shutil.which(tool):
            raise RuntimeError(
                tool
                + " is required. Install Git and Docker with Compose before running setup."
            )
    run(["docker", "compose", "version"])
    run(["docker", "info", "--format", "{{.ServerVersion}}"])


def origin(value):
    url = urllib.parse.urlsplit(value)
    if (
        url.scheme not in ["http", "https"]
        or not url.hostname
        or url.username
        or url.password
        or url.path
        or url.query
        or url.fragment
    ):
        raise ValueError("Use a complete HTTP(S) origin without a path or credentials.")
    if url.scheme == "http" and url.hostname not in ["127.0.0.1", "localhost", "::1"]:
        raise ValueError("Remote players require an HTTPS origin and TLS termination.")
    return value


def configure_yaml(source, replacements):
    text = source
    for key, value in replacements.items():
        pattern = r"(?m)^([ \t]*)" + re.escape(key) + r":[^\r\n]*(\r?\n|$)"
        text, count = re.subn(
            pattern, lambda m: m[1] + key + ": " + json.dumps(value) + m[2], text
        )
        if count != 1:
            raise RuntimeError("Expected one Cosmic configuration field: " + key)
    return text


def secure_seed_account(game):
    path = game / "src/main/resources/db/data/161-admin-data.sql"
    if not path.is_file():
        raise RuntimeError("The supported Cosmic seed migration is missing.")
    statement = "UPDATE accounts SET banned=1,password='',nxCredit=0,maplePoint=0,nxPrepaid=0 WHERE name='admin';"
    text = path.read_text(encoding="utf-8")
    if statement not in text:
        path.write_text(text.rstrip() + "\n\n" + statement + "\n", encoding="utf-8")


def managed_catalog(series_one=False, source=None):
    catalog = json.loads(
        (Path(source) if source else ROOT / "data/catalog.example.json").read_text(
            encoding="utf-8"
        )
    )
    if not isinstance(catalog, dict) or not all(
        isinstance(catalog.get(name), list) and catalog[name]
        for name in ["lines", "cards", "variants", "rarities", "products"]
    ):
        raise RuntimeError("Choose a complete framework catalog with cards and packs.")
    if any(v.get("codes") for v in catalog["variants"]) or any(
        c.get("type") == "code" for c in catalog["cards"]
    ):
        raise RuntimeError(
            "The managed catalog input must contain collectibles only; use --series-one to add the supplied code insert."
        )
    if series_one:
        line = catalog["lines"][0]["id"]
        catalog["cards"].append(
            {
                "id": "series-one-code",
                "lineId": line,
                "name": "Series One code card",
                "type": "code",
                "behavior": {"tradable": False, "albumEligible": True},
            }
        )
        catalog["variants"].append(
            {
                "id": "series-one-code.standard",
                "cardId": "series-one-code",
                "rarityId": catalog["rarities"][0]["id"],
                "codes": [
                    {
                        "id": "game",
                        "poolId": "v83.series-one",
                        "reveal": "peel",
                        "transfer": "block",
                        "title": "Series One reward",
                    }
                ],
            }
        )
        for product in catalog["products"]:
            product["slots"].append(
                {
                    "id": "series-one-insert",
                    "role": "insert",
                    "count": 1,
                    "pool": [{"variantId": "series-one-code.standard", "weight": 1}],
                }
            )
    return catalog


def bridge_snapshot(directory):
    destination = directory / "bridge"
    if destination.is_symlink():
        raise RuntimeError("The managed build directory must not be a symbolic link.")
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(exist_ok=True)
    for folder in ["src", "starter", "data"]:
        shutil.copytree(ROOT / folder, destination / folder, dirs_exist_ok=True)
    for name in [
        "package.json",
        "package-lock.json",
        "LICENSE",
        "NOTICE",
        "NOTICE.md",
        "THIRD_PARTY_NOTICES.md",
        "THIRD-PARTY-NOTICES.md",
    ]:
        if (ROOT / name).is_file():
            shutil.copy2(ROOT / name, destination / name)
    (destination / "tools").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "tools/doctor.mjs", destination / "tools/doctor.mjs")
    digest = hashlib.sha256()
    for path in sorted(destination.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(destination).as_posix().encode())
            digest.update(path.read_bytes())
    for folder in [ROOT / "java", TEMPLATES]:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                digest.update(path.relative_to(ROOT).as_posix().encode())
                digest.update(path.read_bytes())
    digest.update((ROOT / "tools/install-cosmic.py").read_bytes())
    digest.update((ROOT / "tools/cosmic.py").read_bytes())
    return digest.hexdigest()


def create_compose(meta, images):
    project = meta["project"]
    private = "./private/"
    shared = {"security_opt": ["no-new-privileges:true"], "restart": "unless-stopped"}
    return {
        "name": project,
        "services": {
            "network": {
                **shared,
                "image": images["node"],
                "user": "1000:1000",
                "read_only": True,
                "cap_drop": ["ALL"],
                "entrypoint": ["/bin/sleep", "infinity"],
                "ports": [
                    "127.0.0.1:" + str(meta["webPort"]) + ":8080",
                    meta["bind"] + ":" + str(meta["loginPort"]) + ":8484",
                    meta["bind"] + ":7575-7577:7575-7577",
                ],
            },
            "db": {
                **shared,
                "image": images["database"],
                "env_file": [private + "database.env"],
                "volumes": ["database:/var/lib/mysql"],
                "healthcheck": {
                    "test": [
                        "CMD-SHELL",
                        'MYSQL_PWD="$$MYSQL_ROOT_PASSWORD" mysql -h 127.0.0.1 -u root -N -e "SELECT 1"',
                    ],
                    "interval": "5s",
                    "timeout": "5s",
                    "retries": 60,
                },
            },
            "cosmic": {
                **shared,
                "image": project + ":game-" + meta["bridgeHash"][:12],
                "build": {
                    "context": ".",
                    "dockerfile": "support/Game.Dockerfile",
                    "args": {
                        "MAVEN_IMAGE": images["maven"],
                        "JAVA_IMAGE": images["java"],
                    },
                },
                "network_mode": "service:network",
                "depends_on": {
                    "db": {"condition": "service_healthy"},
                    "network": {"condition": "service_started"},
                },
                "env_file": [private + "game.env"],
                "environment": {"DB_HOST": "db"},
                "volumes": [private + "config.yaml:/opt/server/config.yaml:ro"],
                "stop_grace_period": "120s",
                "healthcheck": {
                    "test": ["CMD-SHELL", 'bash -c "echo >/dev/tcp/127.0.0.1/8486"'],
                    "interval": "5s",
                    "timeout": "3s",
                    "retries": 120,
                },
            },
            "cards": {
                **shared,
                "image": project + ":cards-" + meta["bridgeHash"][:12],
                "build": {
                    "context": ".",
                    "dockerfile": "support/Card.Dockerfile",
                    "args": {"NODE_IMAGE": images["node"]},
                },
                "network_mode": "service:network",
                "depends_on": {"cosmic": {"condition": "service_started"}},
                "env_file": [private + "cards.env"],
                "read_only": True,
                "volumes": [
                    "card_state:/opt/card/state",
                    private + "catalog.json:/opt/card/catalog.json:ro",
                ],
                "tmpfs": ["/tmp:size=16m"],
                "healthcheck": {
                    "test": ["CMD", "node", "tools/doctor.mjs", "--quiet"],
                    "interval": "10s",
                    "timeout": "15s",
                    "retries": 90,
                },
            },
            "web": {
                **shared,
                "image": images["web"],
                "user": "101:101",
                "network_mode": "service:network",
                "depends_on": {"cards": {"condition": "service_healthy"}},
                "read_only": True,
                "cap_drop": ["ALL"],
                "tmpfs": ["/tmp:size=16m"],
                "volumes": ["./support/nginx.conf:/etc/nginx/nginx.conf:ro"],
                "entrypoint": ["nginx", "-g", "daemon off;"],
                "healthcheck": {
                    "test": [
                        "CMD-SHELL",
                        "wget -q -O /dev/null http://127.0.0.1:8080/api/library/health",
                    ],
                    "interval": "10s",
                    "timeout": "15s",
                    "retries": 20,
                },
            },
        },
        "volumes": {"database": {}, "card_state": {}},
    }


def lock_images(directory):
    lock = directory / "images.lock.json"
    if lock.exists():
        return json.loads(lock.read_text(encoding="utf-8"))
    result = {}
    for name, image in RUNTIME["images"].items():
        print("Preparing container runtime: " + name, flush=True)
        run(["docker", "pull", image])
        digest = json.loads(
            run(
                [
                    "docker",
                    "image",
                    "inspect",
                    image,
                    "--format",
                    "{{json .RepoDigests}}",
                ],
                capture=True,
            )
        )[0]
        if "@sha256:" not in digest:
            raise RuntimeError("Runtime image has no content digest.")
        result[name] = digest
    private_file(lock, json.dumps(result, indent=2) + "\n")
    return result


def install(args):
    prerequisites()
    directory = Path(args.directory).resolve()
    if (
        directory == ROOT
        or ROOT in directory.parents
        or directory == directory.parent
        or directory == Path.home()
    ):
        raise RuntimeError(
            "Choose a separate installation directory outside this source repository."
        )
    ipaddress.IPv4Address(args.game_host)
    ipaddress.IPv4Address(args.bind)
    public_origin = origin(args.origin or "http://127.0.0.1:" + str(args.web_port))
    if (
        not all(1 <= p <= 65535 for p in [args.web_port, args.login_port])
        or args.web_port == args.login_port
        or any(p in [7575, 7576, 7577] for p in [args.web_port, args.login_port])
    ):
        raise ValueError(
            "Choose separate valid web and login ports outside the channel range."
        )
    options = {k: v for k, v in vars(args).items() if k != "directory"}
    custom_catalog = getattr(args, "catalog", None)
    if custom_catalog and (
        Path(custom_catalog).resolve() == directory
        or directory in Path(custom_catalog).resolve().parents
    ):
        raise RuntimeError(
            "Keep the source catalog outside the managed installation directory."
        )
    prepared_catalog = managed_catalog(args.series_one, custom_catalog)
    if custom_catalog:
        options["catalogHash"] = file_hash(Path(custom_catalog))
    marker = directory / "setup.pending.json"
    if directory.exists() and any(directory.iterdir()):
        if (
            not marker.is_file()
            or json.loads(marker.read_text(encoding="utf-8")) != options
        ):
            raise RuntimeError(
                "Installation directory is not empty. Use the same install options to resume, or start/upgrade for a completed installation."
            )
        if (directory / "installation.json").is_file():
            _, meta = load(directory)
            finish_install(directory, meta, args)
            return
    directory.mkdir(parents=True, exist_ok=True)
    private_file(marker, json.dumps(options, indent=2) + "\n")
    private_file(directory / ".gitignore", "*\n")
    game = directory / "cosmic"
    if args.cosmic_directory:
        source = Path(args.cosmic_directory).resolve()
        if (
            source == directory
            or directory in source.parents
            or source in directory.parents
        ):
            raise RuntimeError("Source and installation directories must be separate.")
        revision = run(
            ["git", "-C", str(source), "rev-parse", "HEAD"], capture=True
        ).strip()
        if run(
            ["git", "-C", str(source), "status", "--porcelain"], capture=True
        ).strip():
            raise RuntimeError(
                "Commit source changes before creating a deployment copy."
            )
        shutil.copytree(
            source,
            game,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(
                ".git", "target", "*.log", ".env", "*.env", "state", "node_modules"
            ),
        )
    else:
        print("Preparing supported Cosmic source", flush=True)
        if not game.exists():
            run(
                [
                    "git",
                    "clone",
                    "--quiet",
                    "--no-checkout",
                    RUNTIME["cosmicRepository"],
                    str(game),
                ]
            )
        run(["git", "-C", str(game), "checkout", "--quiet", RUNTIME["cosmicRevision"]])
        revision = run(
            ["git", "-C", str(game), "rev-parse", "HEAD"], capture=True
        ).strip()
        if revision != RUNTIME["cosmicRevision"]:
            raise RuntimeError(
                "Cosmic source revision does not match the supported release."
            )
    run([sys.executable, str(ROOT / "tools/install-cosmic.py"), str(game), "--check"])
    run([sys.executable, str(ROOT / "tools/install-cosmic.py"), str(game)])
    secure_seed_account(game)
    support = directory / "support"
    shutil.copytree(TEMPLATES, support, dirs_exist_ok=True)
    config = (game / "config.yaml").read_text(encoding="utf-8")
    # Build fixtures have no deployment credentials; the real configuration is mounted only at runtime.
    test_config = configure_yaml(
        config,
        {
            "DB_USER": "cosmic_app",
            "DB_PASS": "",
            "HOST": "127.0.0.1",
            "LANHOST": "127.0.0.1",
            "LOCALHOST": "127.0.0.1",
        },
    )
    (support / "test-config.yaml").write_text(test_config, encoding="utf-8")
    private = directory / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    private.chmod(0o700)
    key_path = private / "setup-keys.json"
    if key_path.exists():
        keys = json.loads(key_path.read_text(encoding="utf-8"))
    else:
        keys = {
            name: base64.b64encode(secrets.token_bytes(32)).decode()
            for name in ["shared", "state", "encryption", "index", "csrf", "gameIndex"]
        }
        keys.update(database=secrets.token_hex(32), databaseRoot=secrets.token_hex(32))
        private_file(key_path, json.dumps(keys) + "\n")
    game_password, root_password = keys["database"], keys["databaseRoot"]
    private_file(
        private / "config.yaml",
        configure_yaml(
            config,
            {
                "DB_USER": "cosmic_app",
                "DB_PASS": game_password,
                "DB_URL_FORMAT": "jdbc:mysql://%s:3306/cosmic?allowPublicKeyRetrieval=true&useSSL=false",
                "HOST": args.game_host,
                "LANHOST": args.game_host,
                "LOCALHOST": args.game_host,
            },
        ),
    )
    private_file(
        private / "database.env",
        "MYSQL_DATABASE=cosmic\nMYSQL_USER=cosmic_app\nMYSQL_PASSWORD="
        + game_password
        + "\nMYSQL_ROOT_PASSWORD="
        + root_password
        + "\n",
    )
    shared = keys["shared"]
    private_file(
        private / "cards.env",
        "\n".join(
            [
                "PUBLIC_ORIGIN=" + public_origin,
                "GAME_URL=http://127.0.0.1:8486",
                "GAME_SHARED_KEY=" + shared,
                "STATE_KEY=" + keys["state"],
                "CODE_ENCRYPTION_KEY=" + keys["encryption"],
                "CODE_INDEX_KEY=" + keys["index"],
                "CSRF_KEY=" + keys["csrf"],
                "STATE_DIRECTORY=/opt/card/state",
                "CATALOG_PATH=/opt/card/catalog.json",
                "AUTH_MODE=bridge",
                "PORT=8487",
                "ACCEPTED_CASH_TYPES=1,2,4",
                "TRUST_PROXY=1",
                "ENABLE_SERIES_ONE_REWARDS=" + ("1" if args.series_one else "0"),
            ]
        )
        + "\n",
    )
    private_file(
        private / "game.env",
        "\n".join(
            [
                "CARD_BRIDGE_ENABLED=1",
                "CARD_BRIDGE_PORT=8486",
                "CARD_BRIDGE_SHARED_KEY=" + shared,
                "CARD_BRIDGE_CODE_KEY=" + keys["gameIndex"],
                "CARD_BRIDGE_CALLBACK_URL=http://127.0.0.1:8487/api/library/provider/used",
                "CARD_BRIDGE_SESSION_SOURCE=bridge",
                "CARD_BRIDGE_ACCEPTED_CASH_TYPES=1,2,4",
            ]
        )
        + "\n",
    )
    private_file(
        private / "catalog.json",
        json.dumps(prepared_catalog, indent=2) + "\n",
    )
    # Only these non-key runtime files are mounted. The private parent stays owner-only.
    (private / "config.yaml").chmod(0o644)
    (private / "catalog.json").chmod(0o644)
    meta = {
        "format": 1,
        "directory": str(directory),
        "project": "cosmic-cards-"
        + hashlib.sha256(str(directory).encode()).hexdigest()[:10],
        "cosmicRevision": revision,
        "origin": public_origin,
        "bind": args.bind,
        "gameHost": args.game_host,
        "webPort": args.web_port,
        "loginPort": args.login_port,
        "seriesOneEnabled": args.series_one,
        "smokeCollectibles": sum(
            slot["count"] for slot in prepared_catalog["products"][0]["slots"]
        )
        - (1 if args.series_one else 0),
        "bridgeHash": bridge_snapshot(directory),
    }
    private_file(
        directory / ".dockerignore",
        "private/\nbackups/\ncosmic/.git\ncosmic/target/\ninstallation.json\n*.log\n",
    )
    images = lock_images(directory)
    private_file(
        directory / "compose.json",
        json.dumps(create_compose(meta, images), indent=2) + "\n",
    )
    private_file(directory / "installation.json", json.dumps(meta, indent=2) + "\n")
    finish_install(directory, meta, args)


def finish_install(directory, meta, args):
    print(
        "Building Cosmic, running its tests, and building the card service", flush=True
    )
    compose(directory, "build")
    start(directory, meta)
    if args.test_account:
        private = directory / "private"
        credentials = private / "test-account.json"
        if not credentials.exists():
            private_file(
                credentials,
                json.dumps(
                    {"username": "CardTest", "password": secrets.token_urlsafe(24)}
                )
                + "\n",
            )
        account = json.loads(credentials.read_text(encoding="utf-8"))
        account_command(directory, {"action": "create", **account})
        account_command(
            directory,
            {
                "action": "fund",
                "username": "CardTest",
                "cashType": 4,
                "amount": 5000,
                "key": "setup-funding-v1",
            },
        )
        smoke(directory, meta)
        print(
            "Disposable CardTest account details saved in private/test-account.json; one pack was purchased for verification."
        )
    print("Ready: " + meta["origin"] + "/library/", flush=True)
    (directory / "setup.pending.json").unlink(missing_ok=True)
    (directory / "private/setup-keys.json").unlink(missing_ok=True)


def doctor(directory, meta):
    compose(directory, "exec", "-T", "cards", "node", "tools/doctor.mjs")
    # Test the public-facing reverse proxy from inside the shared namespace as well.
    compose(
        directory,
        "exec",
        "-T",
        "cards",
        "node",
        "--input-type=module",
        "-e",
        "const r=await fetch('http://127.0.0.1:8080/api/library/health',{signal:AbortSignal.timeout(12000)});if(!r.ok||(await r.json()).gameReady!==true)process.exit(1)",
    )
    print("Ready: " + meta["origin"] + "/library/", flush=True)


def start(directory, meta):
    compose(directory, "up", "-d", "--wait", "db", "network")
    proxy = directory / "support/nginx.conf"
    text = proxy.read_text(encoding="utf-8")
    if "__DOCKER_GATEWAY__" in text:
        gateway = run(
            [
                "docker",
                "network",
                "inspect",
                meta["project"] + "_default",
                "--format",
                "{{(index .IPAM.Config 0).Gateway}}",
            ],
            capture=True,
        ).strip()
        ipaddress.IPv4Address(gateway)
        proxy.write_text(text.replace("__DOCKER_GATEWAY__", gateway), encoding="utf-8")
    compose(directory, "up", "-d", "--wait", "--wait-timeout", "900")
    doctor(directory, meta)


def account_command(directory, value):
    result = compose(
        directory,
        "exec",
        "-T",
        "cosmic",
        "java",
        "-cp",
        "Server.jar:/opt/card-tools",
        "AccountCommand",
        data=json.dumps(value),
        capture=True,
    )
    if "Operator account action completed." not in result:
        raise RuntimeError("The operator account action did not confirm completion.")


def smoke(directory, meta):
    account = json.loads(
        (directory / "private/test-account.json").read_text(encoding="utf-8")
    )
    # Run where the game and bridge run; public DNS/TLS can be checked separately with doctor.
    script = """
const origin=process.env.PUBLIC_ORIGIN,base='http://127.0.0.1:8487';
let cookie='',csrf='';
const input=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>resolve(s))}));
async function call(route,body){const r=await fetch(base+'/api/library/'+route,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok)throw Error(v.code??'SMOKE_FAILED');if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(v.csrf)csrf=v.csrf;return v;}
await call('session');await call('login',{username:input.username,password:input.password});let s=await call('state');let pack=s.packs[0]??s.orders.find(o=>o.state==='complete')?.result?.packs?.[0];
if(!pack){const catalog=await call('catalog'),quote=await call('quote',{productId:catalog.products[0].id,quantity:1,cashType:4}),key='setup-smoke-v1';const bought=await call('buy',{...quote,key});const replay=await call('buy',{...quote,key});if(JSON.stringify(bought)!==JSON.stringify(replay))throw Error('RETRY_MISMATCH');pack=bought.packs[0];}
const opened=await call('open',{packId:pack.id,key:'setup-open-'+pack.id});if(opened.cards.length!==input.collectibles+(input.seriesOne?1:0))throw Error('PACK_CONTENTS');s=await call('state');if(s.inventory.filter(c=>c.definition.type!=='code').length!==input.collectibles||s.codes.length!==(input.seriesOne?1:0))throw Error('PACK_CONTENTS');if(input.seriesOne){if(s.codes[0].registration!=='ready')throw Error('REGISTRATION');const revealed=await call('reveal',{codeId:s.codes[0].id,key:'setup-reveal-'+s.codes[0].id});if(!/^(C0[123])?[A-Z2-9]{15}$/.test(revealed.code))throw Error('CODE_PATTERN');}await call('logout',{});if((await call('session')).signedIn)throw Error('LOGOUT');console.log('Setup smoke passed: native login, selected debit, safe retry, profile contents and logout.');
"""
    compose(
        directory,
        "exec",
        "-T",
        "cards",
        "node",
        "--input-type=module",
        "-e",
        script,
        data=json.dumps(
            {
                **account,
                "seriesOne": meta.get("seriesOneEnabled", False),
                "collectibles": meta.get("smokeCollectibles", 8),
            }
        ),
    )
    print(
        "Setup smoke passed. Native-client Cash Shop redemption is a separate gameplay check."
    )


def no_players(directory):
    script = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root -N cosmic -e "SELECT COUNT(*) FROM accounts WHERE loggedin<>0"'
    count = compose(
        directory, "exec", "-T", "db", "sh", "-c", script, capture=True
    ).strip()
    if count != "0":
        raise RuntimeError("Game accounts are connected. Maintenance was not started.")


def backup(directory, meta, restart=True):
    no_players(directory)
    destination = (
        directory
        / "backups"
        / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(3))
    )
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    image = compose(directory, "images", "-q", "cards", capture=True).strip()
    compose(directory, "stop", "web", "cards", "cosmic")
    success = False
    try:
        sql = compose(
            directory,
            "exec",
            "-T",
            "db",
            "sh",
            "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root --single-transaction --routines --events --triggers --hex-blob cosmic',
            capture=True,
        )
        private_file(destination / "database.sql", sql)
        state = run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--user",
                "10002:10002",
                "--mount",
                "type=volume,source="
                + meta["project"]
                + "_card_state,target=/state,readonly",
                "--entrypoint",
                "tar",
                image,
                "-C",
                "/state",
                "-czf",
                "-",
                ".",
            ],
            data=b"",
            capture=True,
        )
        private_file(destination / "state.tar.gz", state)
        shutil.copytree(directory / "private", destination / "private")
        for name in ["compose.json", "installation.json", "images.lock.json"]:
            shutil.copy2(directory / name, destination / name)
        (destination / "support").mkdir()
        shutil.copy2(
            directory / "support/nginx.conf", destination / "support/nginx.conf"
        )
        profile = json.loads((directory / "compose.json").read_text(encoding="utf-8"))
        images = {
            profile["services"][name]["image"]: run(
                [
                    "docker",
                    "image",
                    "inspect",
                    profile["services"][name]["image"],
                    "--format",
                    "{{.Id}}",
                ],
                capture=True,
            ).strip()
            for name in ["cosmic", "cards"]
        }
        run(
            [
                "docker",
                "image",
                "save",
                "--output",
                str(destination / "runtime-images.tar"),
                *images,
            ]
        )
        private_file(
            destination / "runtime-images.json", json.dumps(images, indent=2) + "\n"
        )
        sums = {
            p.relative_to(destination).as_posix(): file_hash(p)
            for p in destination.rglob("*")
            if p.is_file()
        }
        private_file(destination / "checksums.json", json.dumps(sums, indent=2) + "\n")
        success = True
    finally:
        if restart or not success:
            start(directory, meta)
    print("Private backup: " + str(destination))
    return destination


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_backup(path):
    path = Path(path).resolve()
    sums = json.loads((path / "checksums.json").read_text(encoding="utf-8"))
    allowed = {
        "database.sql",
        "state.tar.gz",
        "compose.json",
        "installation.json",
        "images.lock.json",
        "runtime-images.tar",
        "runtime-images.json",
        "support/nginx.conf",
        "private/config.yaml",
        "private/database.env",
        "private/game.env",
        "private/cards.env",
        "private/catalog.json",
        "private/test-account.json",
    }
    if not set(sums) <= allowed or not {
        "database.sql",
        "state.tar.gz",
        "compose.json",
        "installation.json",
        "images.lock.json",
        "runtime-images.tar",
        "runtime-images.json",
        "support/nginx.conf",
        "private/config.yaml",
        "private/database.env",
        "private/game.env",
        "private/cards.env",
        "private/catalog.json",
    } <= set(sums):
        raise RuntimeError("Unexpected or incomplete backup files.")
    for name, expected in sums.items():
        p = path / name
        if (
            p.is_symlink()
            or not p.resolve().is_relative_to(path)
            or not p.is_file()
            or file_hash(p) != expected
        ):
            raise RuntimeError("Backup integrity check failed.")
    with tarfile.open(path / "state.tar.gz") as archive:
        allowed_state = {
            "framework.sqlite",
            "framework.sqlite-wal",
            "framework.sqlite-shm",
            "bridge.sqlite",
            "bridge.sqlite-wal",
            "bridge.sqlite-shm",
        }
        for member in archive.getmembers():
            name = member.name.removeprefix("./")
            if member.isdir() and member.name in [".", "./"]:
                continue
            if not member.isfile() or name not in allowed_state:
                raise RuntimeError("Unexpected state archive member.")
    return path


def restore_data(directory, meta, source):
    compose(directory, "stop", "web", "cards", "cosmic")
    # Database credentials do not change during restore; backups belong to this installation.
    if (directory / "private/database.env").read_bytes() != (
        source / "private/database.env"
    ).read_bytes():
        raise RuntimeError(
            "Restore database credentials differ from this installation."
        )
    images = json.loads((source / "runtime-images.json").read_text(encoding="utf-8"))
    if len(images) != 2 or any(
        not name.startswith(meta["project"] + ":")
        or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
        for name, digest in images.items()
    ):
        raise RuntimeError("Unexpected backup runtime images.")
    run(["docker", "image", "load", "--input", str(source / "runtime-images.tar")])
    for name, digest in images.items():
        if (
            run(
                ["docker", "image", "inspect", name, "--format", "{{.Id}}"],
                capture=True,
            ).strip()
            != digest
        ):
            raise RuntimeError("Backup runtime image identity differs.")
    sql = (source / "database.sql").read_bytes()
    compose(
        directory,
        "exec",
        "-T",
        "db",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u cosmic_app cosmic',
        data=sql,
    )
    image = compose(directory, "images", "-q", "cards", capture=True).strip()
    run(
        [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--user",
            "10002:10002",
            "--mount",
            "type=volume,source=" + meta["project"] + "_card_state,target=/state",
            "--entrypoint",
            "sh",
            image,
            "-c",
            'find /state -maxdepth 1 -type f -name "*.sqlite*" -delete; tar -C /state -xzf -',
        ],
        data=(source / "state.tar.gz").read_bytes(),
    )
    for name in ["game.env", "cards.env", "catalog.json", "config.yaml"]:
        private_file(
            directory / "private" / name, (source / "private" / name).read_bytes()
        )
    (directory / "private/config.yaml").chmod(0o644)
    (directory / "private/catalog.json").chmod(0o644)
    private_file(directory / "compose.json", (source / "compose.json").read_bytes())
    private_file(
        directory / "installation.json", (source / "installation.json").read_bytes()
    )
    private_file(
        directory / "images.lock.json", (source / "images.lock.json").read_bytes()
    )
    (directory / "support/nginx.conf").write_bytes(
        (source / "support/nginx.conf").read_bytes()
    )
    start(directory, meta)


def restore(directory, meta, source):
    source = validate_backup(source)
    saved = json.loads((source / "installation.json").read_text(encoding="utf-8"))
    if saved["directory"] != str(directory) or saved["project"] != meta["project"]:
        raise RuntimeError("Restore this backup to its original installation only.")
    safety = backup(directory, meta, restart=False)
    try:
        restore_data(directory, saved, source)
    except Exception:
        restore_data(directory, meta, safety)
        raise RuntimeError(
            "Restore failed; the pre-restore backup was restored."
        ) from None
    print("Backup restored and connection verified.")


def upgrade(directory, meta):
    no_players(directory)
    pending = compose(
        directory,
        "exec",
        "-T",
        "cards",
        "node",
        "--input-type=module",
        "-e",
        "import{DatabaseSync}from'node:sqlite';let d=new DatabaseSync('/opt/card/state/bridge.sqlite',{readOnly:true});console.log(d.prepare(\"SELECT COUNT(*) AS n FROM orders WHERE state NOT IN ('complete','rejected')\").get().n);d.close()",
        capture=True,
    ).strip()
    if pending != "0":
        raise RuntimeError("Finish pending purchases before upgrading.")
    previous = json.loads((directory / "compose.json").read_text(encoding="utf-8"))
    settings = dict(
        line.split("=", 1)
        for line in (directory / "private/cards.env")
        .read_text(encoding="utf-8")
        .splitlines()
        if line and not line.startswith("#")
    )
    catalog = json.loads(
        (directory / "private/catalog.json").read_text(encoding="utf-8")
    )
    rewards = settings.get(
        "ENABLE_SERIES_ONE_REWARDS",
        "1" if any(v.get("codes") for v in catalog["variants"]) else "0",
    )
    if rewards not in ["0", "1"]:
        raise RuntimeError("Invalid Series One provider configuration.")
    new_meta = {
        **meta,
        "bridgeHash": bridge_snapshot(directory),
        "seriesOneEnabled": rewards == "1",
    }
    run(
        [
            sys.executable,
            str(ROOT / "tools/install-cosmic.py"),
            str(directory / "cosmic"),
            "--check",
        ]
    )
    run(
        [
            sys.executable,
            str(ROOT / "tools/install-cosmic.py"),
            str(directory / "cosmic"),
        ]
    )
    shutil.copytree(TEMPLATES, directory / "support", dirs_exist_ok=True)
    candidate = create_compose(new_meta, lock_images(directory))
    private_file(directory / "compose.json", json.dumps(candidate, indent=2) + "\n")
    try:
        compose(directory, "build")
    except Exception:
        private_file(directory / "compose.json", json.dumps(previous, indent=2) + "\n")
        raise
    private_file(directory / "compose.json", json.dumps(previous, indent=2) + "\n")
    safety = backup(directory, meta, restart=False)
    if "ENABLE_SERIES_ONE_REWARDS" not in settings:
        path = directory / "private/cards.env"
        private_file(
            path,
            path.read_text(encoding="utf-8").rstrip()
            + "\nENABLE_SERIES_ONE_REWARDS="
            + rewards
            + "\n",
        )
    private_file(directory / "compose.json", json.dumps(candidate, indent=2) + "\n")
    private_file(directory / "installation.json", json.dumps(new_meta, indent=2) + "\n")
    try:
        start(directory, new_meta)
    except Exception:
        restore_data(directory, meta, safety)
        raise RuntimeError(
            "Upgrade failed; previous images, keys and data were restored."
        ) from None
    print("Upgrade completed; catalog, issued codes and encryption keys retained.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--directory",
        default="../CosmicCardServer",
        help="Managed installation directory",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser(
        "install", help="Create and start a complete new deployment"
    )
    setup.add_argument(
        "--cosmic-directory",
        help="Copy an existing clean Cosmic checkout instead of cloning stock Cosmic",
    )
    setup.add_argument(
        "--game-host",
        default="127.0.0.1",
        help="IPv4 address advertised to the v83 client",
    )
    setup.add_argument(
        "--bind",
        default="127.0.0.1",
        help="Host interface for game ports; web remains loopback",
    )
    setup.add_argument(
        "--origin", help="Public HTTP(S) origin; HTTPS is required for remote players"
    )
    setup.add_argument("--web-port", type=int, default=8490)
    setup.add_argument("--login-port", type=int, default=8484)
    setup.add_argument(
        "--test-account",
        action="store_true",
        help="Create and fund a disposable CardTest account and exercise a real pack",
    )
    setup.add_argument(
        "--series-one",
        action="store_true",
        help="Enable the Series One provider and add one code insert per pack",
    )
    setup.add_argument(
        "--catalog",
        help="Install a collectible catalog, including imported packs with direct-source images",
    )
    for name in ["start", "doctor", "stop", "backup", "upgrade", "smoke"]:
        commands.add_parser(name)
    recover = commands.add_parser("restore")
    recover.add_argument("--backup", required=True)
    account = commands.add_parser("account")
    account.add_argument("action", choices=["create", "fund"])
    account.add_argument("username")
    account.add_argument("--cash-type", type=int, choices=[1, 2, 4], default=4)
    account.add_argument("--amount", type=int)
    account.add_argument("--password-file")
    account.add_argument(
        "--request-id",
        help="Stable funding identity; reuse after an uncertain response",
    )
    args = parser.parse_args()
    if args.command == "install":
        install(args)
        return
    directory, meta = load(args.directory)
    if args.command == "start":
        start(directory, meta)
    elif args.command == "doctor":
        doctor(directory, meta)
    elif args.command == "stop":
        no_players(directory)
        compose(directory, "stop", "web", "cards", "cosmic", "network", "db")
    elif args.command == "backup":
        backup(directory, meta)
    elif args.command == "restore":
        restore(directory, meta, args.backup)
    elif args.command == "upgrade":
        upgrade(directory, meta)
    elif args.command == "smoke":
        smoke(directory, meta)
    elif args.command == "account":
        value = {"action": args.action, "username": args.username}
        if args.action == "create":
            value["password"] = (
                Path(args.password_file).read_text(encoding="utf-8").rstrip("\r\n")
                if args.password_file
                else getpass.getpass("New account password: ")
            )
        else:
            if not args.amount:
                raise ValueError("Provide --amount for funding.")
            value.update(cashType=args.cash_type, amount=args.amount)
            if not args.request_id:
                raise ValueError(
                    "Provide a unique --request-id for funding; reuse it when retrying the same credit."
                )
            value["key"] = args.request_id
        account_command(directory, value)
        print("Operator account action completed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, urllib.error.URLError) as error:
        print("Setup stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
