"""The installer rejects incomplete or misplaced atomic character-save hooks."""

from pathlib import Path
import ast
import re
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "tools/install-cosmic.py"
tree = ast.parse(INSTALLER.read_text(encoding="utf-8"))
functions = [
    node
    for node in tree.body
    if isinstance(node, ast.FunctionDef)
    and node.name in {"masked_java", "patch_character_save"}
]
namespace = {"re": re}
exec(
    compile(ast.Module(body=functions, type_ignores=[]), str(INSTALLER), "exec"),
    namespace,
)
patch_character_save = namespace["patch_character_save"]


def character(body, extra=""):
    return (
        "package client;\npublic class Character {\n"
        "    public synchronized void saveCharToDB(boolean notAutosave) {\n"
        + body
        + "\n    }\n"
        + extra
        + "}\n"
    )


BEFORE = "        BridgeRewards.beforeSave(con, this);"
COMMIT = "        con.commit();"
AFTER = "        BridgeRewards.afterSave(this);"


class CharacterSaveHooksTest(unittest.TestCase):
    def test_unpatched_commit_is_paired_and_reapplying_is_idempotent(self):
        source = character(COMMIT)
        patched = patch_character_save(source)
        self.assertIn("\n".join([BEFORE, COMMIT, AFTER]), patched)
        self.assertEqual(patched, patch_character_save(patched))

    def test_complete_existing_pair_is_accepted(self):
        source = character("\n".join([BEFORE, COMMIT, AFTER]))
        self.assertEqual(source, patch_character_save(source))

    def test_partial_duplicate_reversed_and_misplaced_hooks_are_rejected(self):
        fixtures = [
            character("\n".join([BEFORE, COMMIT])),
            character("\n".join([COMMIT, AFTER])),
            character("\n".join([COMMIT, BEFORE, AFTER])),
            character("\n".join([BEFORE, BEFORE, COMMIT, AFTER])),
            character("\n".join([BEFORE, COMMIT, AFTER, AFTER])),
            character(COMMIT, "    public void other() { " + BEFORE + AFTER + " }\n"),
            character(
                "\n".join([BEFORE, COMMIT, AFTER]),
                "    public void other() { " + BEFORE + " }\n",
            ),
            character("\n".join([BEFORE.replace("this", "other"), COMMIT, AFTER])),
            character("\n".join([BEFORE, COMMIT, COMMIT, AFTER])),
        ]
        for index, source in enumerate(fixtures):
            with self.subTest(fixture=index), self.assertRaises(SystemExit):
                patch_character_save(source)

    def test_comments_literals_and_nested_braces_do_not_spoof_hooks(self):
        source = character(
            "        // BridgeRewards.beforeSave(con, this);\n"
            '        String comment = "BridgeRewards.afterSave(this); }";\n'
            "        if (true) { /* } */ }\n" + COMMIT
        )
        patched = patch_character_save(source)
        self.assertIn("\n".join([BEFORE, COMMIT, AFTER]), patched)
        self.assertEqual(patched, patch_character_save(patched))

    def test_comments_between_valid_hooks_do_not_hide_their_order(self):
        source = character(
            "\n".join([BEFORE, "        /* explanatory note */", COMMIT, AFTER])
        )
        self.assertEqual(source, patch_character_save(source))

    def test_missing_or_ambiguous_save_method_is_rejected(self):
        fixtures = [
            "public class Character {}",
            character(COMMIT) + character(COMMIT),
            character(COMMIT).replace("synchronized ", ""),
            character(COMMIT)[:-8],
        ]
        for index, source in enumerate(fixtures):
            with self.subTest(fixture=index), self.assertRaises(SystemExit):
                patch_character_save(source)

    def test_check_and_install_reject_invalid_hooks_before_any_source_write(self):
        source = character("\n".join([COMMIT, BEFORE, AFTER]))
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            coupon = (
                base
                / "src/main/java/net/server/channel/handlers/CouponCodeHandler.java"
            )
            saved = base / "src/main/java/client/Character.java"
            coupon.parent.mkdir(parents=True)
            saved.parent.mkdir(parents=True)
            coupon.write_text(
                "                Pair<Integer, List<Pair<Integer, Pair<Integer, Integer>>>> codeRes =",
                encoding="utf-8",
            )
            saved.write_text(source, encoding="utf-8")
            before = {path: path.read_bytes() for path in [coupon, saved]}
            for options in [[], ["--check"]]:
                result = subprocess.run(
                    [sys.executable, str(INSTALLER), str(base), *options],
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(0, result.returncode)
                self.assertIn("Invalid character save hooks", result.stderr)
                self.assertEqual(before, {path: path.read_bytes() for path in before})


if __name__ == "__main__":
    unittest.main()
