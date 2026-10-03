#!/usr/bin/env python3
"""Install the v83 adapter into a supported Cosmic/HeavenMS-derived checkout."""
from pathlib import Path
import argparse, shutil, re

p = argparse.ArgumentParser()
p.add_argument("server", type=Path)
p.add_argument("--check", action="store_true")
args = p.parse_args()
base = args.server.resolve()
source = Path(__file__).resolve().parents[1] / "java"
patches = {
    "src/main/java/net/server/channel/handlers/CouponCodeHandler.java": [
        (
            "                Pair<Integer, List<Pair<Integer, Pair<Integer, Integer>>>> codeRes =",
            "                if (server.cardbridge.BridgeRewards.handle(c, code)) return;\n                Pair<Integer, List<Pair<Integer, Pair<Integer, Integer>>>> codeRes =",
        )
    ],
    "src/main/java/client/Character.java": [
        ("package client;", "package client;\nimport server.cardbridge.BridgeRewards;")
    ],
    "src/main/java/server/CashShop.java": [
        (
            "    public int getCash(int type) {\n",
            "    public int getCash(int type) {\n        if (server.cardbridge.BridgeHttp.enabled() && (type == 1 || type == 2 || type == 4)) return server.cardbridge.BridgeWallet.read(accountId, type);\n",
        ),
        (
            "    public void gainCash(int type, int cash) {\n",
            "    public void gainCash(int type, int cash) {\n        if (server.cardbridge.BridgeHttp.enabled() && (type == 1 || type == 2 || type == 4)) { if (cash != 0) server.cardbridge.BridgeWallet.change(accountId, type, cash); return; }\n",
        ),
        (
            "    public void save(Connection con) throws SQLException {\n        try (PreparedStatement",
            "    public void save(Connection con) throws SQLException {\n        if (!server.cardbridge.BridgeHttp.enabled()) {\n        try (PreparedStatement",
        ),
        (
            "            ps.setInt(4, accountId);\n            ps.executeUpdate();\n        }\n\n        List<Pair<Item, InventoryType>> itemsWithType",
            "            ps.setInt(4, accountId);\n            ps.executeUpdate();\n        }\n        }\n\n        List<Pair<Item, InventoryType>> itemsWithType",
        ),
    ],
    "src/main/java/net/server/Server.java": [
        (
            "package net.server;",
            "package net.server;\nimport server.cardbridge.BridgeHttp;",
        ),
        (
            "        loginServer.start();",
            "        BridgeHttp.start();\n        loginServer.start();",
        ),
    ],
    "pom.xml": [],
}
proposed = {}
for rel, replacements in patches.items():
    file = base / rel
    if not file.is_file():
        raise SystemExit("Unsupported checkout: missing " + rel)
    text = file.read_text(encoding="utf-8")
    for old, new in replacements:
        if new in text:
            continue
        if text.count(old) != 1:
            raise SystemExit(
                "Unsupported source revision: "
                + rel
                + ". Apply the documented hook manually."
            )
        text = text.replace(old, new, 1)
    if rel == "pom.xml":
        for group, artifact, version, scope in [
            ("com.google.code.gson", "gson", "2.13.2", None),
            ("com.h2database", "h2", "2.3.232", "test"),
        ]:
            blocks = re.findall(r"<dependency>.*?</dependency>", text, re.S)
            found = [
                b
                for b in blocks
                if re.search(r"<artifactId>\s*" + artifact + r"\s*</artifactId>", b)
            ]
            if any(
                not re.search(
                    r"<version>\s*" + re.escape(version) + r"\s*</version>", b
                )
                for b in found
            ):
                raise SystemExit(
                    "Conflicting "
                    + artifact
                    + " version; resolve the dependency before installing."
                )
            if found:
                for duplicate in found[1:]:
                    first = text.find(duplicate)
                    second = text.find(duplicate, first + len(duplicate))
                    if second >= 0:
                        text = text[:second] + text[second + len(duplicate) :]
                continue
            if text.count("    <dependencies>") != 1:
                raise SystemExit("Unsupported Maven dependencies layout")
            block = (
                "\n        <dependency>\n            <groupId>"
                + group
                + "</groupId>\n            <artifactId>"
                + artifact
                + "</artifactId>\n            <version>"
                + version
                + "</version>"
            )
            if scope:
                block += "\n            <scope>" + scope + "</scope>"
            text = text.replace(
                "    <dependencies>",
                "    <dependencies>" + block + "\n        </dependency>",
                1,
            )
        if "<id>card-bridge-contract</id>" not in text:
            # The game initializes WZ paths once per JVM; keep adapter SQL fixtures isolated.
            plugin = re.search(
                r"<plugin>\s*<groupId>org.apache.maven.plugins</groupId>\s*<artifactId>maven-surefire-plugin</artifactId>.*?</plugin>",
                text,
                re.S,
            )
            if plugin is None or "<executions>" in plugin.group():
                raise SystemExit(
                    "Resolve the Surefire execution layout before installing adapter tests."
                )
            replacement = plugin.group().replace(
                "</plugin>",
                "<executions>\n                    <execution><id>default-test</id><configuration><excludes><exclude>**/BridgeContractTest.java</exclude></excludes></configuration></execution>\n                    <execution><id>card-bridge-contract</id><goals><goal>test</goal></goals><configuration><includes><include>**/BridgeContractTest.java</include></includes><forkCount>1</forkCount><reuseForks>false</reuseForks></configuration></execution>\n                </executions>"
                + "\n            </plugin>",
            )
            text = text[: plugin.start()] + replacement + text[plugin.end() :]
    if rel.endswith("client/Character.java"):
        text = text.replace(
            "server.cardbridge.BridgeRewards.beforeSave", "BridgeRewards.beforeSave"
        ).replace(
            "server.cardbridge.BridgeRewards.afterSave", "BridgeRewards.afterSave"
        )
        if "BridgeRewards.beforeSave(con, this)" not in text:
            start = text.find(
                "public synchronized void saveCharToDB(boolean notAutosave)"
            )
            end = text.find("\n    public ", start + 20)
            if start < 0 or end < 0:
                raise SystemExit("Unsupported character save method")
            section = text[start:end]
            commit = section.rfind("                con.commit();")
            if commit < 0:
                raise SystemExit("Character transaction commit missing")
            section = section[:commit] + section[commit:].replace(
                "                con.commit();",
                "                BridgeRewards.beforeSave(con, this);\n                con.commit();\n                BridgeRewards.afterSave(this);",
                1,
            )
            text = text[:start] + section + text[end:]
    if rel.endswith("net/server/Server.java"):
        text = text.replace(
            "server.cardbridge.BridgeHttp.start()", "BridgeHttp.start()"
        )
    proposed[file] = text
# Validate every hook before writing any part of the installation.
if not args.check:
    for file, text in proposed.items():
        file.write_text(text, encoding="utf-8", newline="\n")
    for file in source.rglob("*"):
        if file.is_file():
            dst = base / file.relative_to(source)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, dst)
print(
    "Adapter hooks validated."
    if args.check
    else "Adapter source, resources and hooks installed."
)
