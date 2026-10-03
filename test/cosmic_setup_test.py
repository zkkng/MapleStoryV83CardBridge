import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from argparse import Namespace

spec = importlib.util.spec_from_file_location(
    "cosmic_setup", Path(__file__).parents[1] / "tools/cosmic.py"
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupSafety(unittest.TestCase):
    def test_seed_account_is_disabled_before_login_and_patch_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            game = Path(directory)
            p = game / "src/main/resources/db/data/161-admin-data.sql"
            p.parent.mkdir(parents=True)
            p.write_text("SELECT 1;\n")
            setup.secure_seed_account(game)
            first = p.read_bytes()
            setup.secure_seed_account(game)
            self.assertEqual(first, p.read_bytes())
            self.assertIn("banned=1,password=''", p.read_text())

    def test_interrupted_install_resumes_without_replacing_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory).resolve()
            args = Namespace(
                directory=str(p),
                command="install",
                cosmic_directory=None,
                game_host="127.0.0.1",
                bind="127.0.0.1",
                origin=None,
                web_port=8490,
                login_port=8484,
                test_account=True,
            )
            options = {k: v for k, v in vars(args).items() if k != "directory"}
            setup.private_file(p / "setup.pending.json", json.dumps(options))
            setup.private_file(
                p / "installation.json", json.dumps({"format": 1, "directory": str(p)})
            )
            setup.private_file(p / "private/cards.env", "fixture persistent keys")
            with patch.object(setup, "prerequisites"), patch.object(
                setup, "finish_install"
            ) as finish:
                setup.install(args)
                finish.assert_called_once()
                self.assertEqual(
                    (p / "private/cards.env").read_text(), "fixture persistent keys"
                )
                args.web_port = 8499
                with self.assertRaises(RuntimeError):
                    setup.install(args)

    def test_external_plaintext_origins_are_rejected(self):
        for origin in [
            "http://cards.example.test",
            "https://fixture@cards.example.test",
            "https://:fixture@cards.example.test",
            "https://cards.example.test/path",
        ]:
            with self.assertRaises(ValueError):
                setup.origin(origin)
        self.assertEqual(
            setup.origin("https://cards.example.test"), "https://cards.example.test"
        )

    def test_config_requires_exact_fields_and_preserves_unrelated_settings(self):
        source = (
            'server:\n    DB_PASS: "old"\n    HOST: 127.0.0.1 # address\n    WORLD: 3\n'
        )
        updated = setup.configure_yaml(
            source, {"DB_PASS": "fixture-value", "HOST": "192.0.2.1"}
        )
        self.assertIn("WORLD: 3", updated)
        self.assertNotIn('"old"', updated)
        with self.assertRaises(RuntimeError):
            setup.configure_yaml(source, {"UNKNOWN": "value"})
        with self.assertRaises(RuntimeError):
            setup.configure_yaml(
                source + "    HOST: 127.0.0.1\n", {"HOST": "192.0.2.1"}
            )

    def test_database_and_adapter_ports_stay_private(self):
        meta = {
            "project": "fixture",
            "bridgeHash": "a" * 64,
            "bind": "127.0.0.1",
            "webPort": 8490,
            "loginPort": 8484,
        }
        profile = setup.create_compose(
            meta, {k: "image@sha256:" + ("a" * 64) for k in setup.RUNTIME["images"]}
        )
        self.assertNotIn("ports", profile["services"]["db"])
        self.assertEqual(
            profile["services"]["cards"]["network_mode"], "service:network"
        )
        self.assertEqual(profile["services"]["web"]["network_mode"], "service:network")
        self.assertEqual(
            profile["services"]["cosmic"]["network_mode"], "service:network"
        )
        self.assertFalse(
            any(
                ":8486" in port or ":8487" in port
                for port in profile["services"]["network"]["ports"]
            )
        )
        self.assertTrue(profile["services"]["cards"]["read_only"])

    def test_restore_rejects_foreign_files_and_state_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            (p / "checksums.json").write_text(json.dumps({"../outside": "a" * 64}))
            with self.assertRaises(RuntimeError):
                setup.validate_backup(p)
            with tarfile.open(p / "state.tar.gz", "w:gz") as archive:
                data = b"fixture"
                info = tarfile.TarInfo("../outside")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            names = [
                "database.sql",
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
            ]
            for name in names:
                setup.private_file(p / name, b"fixture")
            sums = {
                x.relative_to(p)
                .as_posix(): setup.hashlib.sha256(x.read_bytes())
                .hexdigest()
                for x in p.rglob("*")
                if x.is_file() and x.name != "checksums.json"
            }
            (p / "checksums.json").write_text(json.dumps(sums))
            with self.assertRaises(RuntimeError):
                setup.validate_backup(p)


if __name__ == "__main__":
    unittest.main()
