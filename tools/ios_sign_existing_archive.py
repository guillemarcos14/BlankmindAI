"""Sign an exact unsigned CI archive with existing local distribution credentials.

Does not export private keys, create certificates, change capabilities or upload.
Requires macOS codesign/security and profiles already installed for this team.
"""
import datetime
import fnmatch
import hashlib
import json
import pathlib
import plistlib
import re
import shutil
import subprocess
import sys

TEAM = "GS54UV79RG"
EXPECTED_SOURCE = "5ffcb0eab3bdace69b21d7741ff102d271654f34"
EXPECTED_IOS_TREE = "c8df357d102121139a3ab924457abdbc2e71df78"
EXPECTED_ARCHIVE_SHA = "958a5aa97179cebaa6ac201dc78b58e60c80d6fb39b30925b5cd9065bf5dca3f"


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def allowed(requested, available):
    if isinstance(requested, bool):
        return requested is available
    if isinstance(requested, str):
        return isinstance(available, str) and fnmatch.fnmatchcase(requested, available)
    if isinstance(requested, list):
        return isinstance(available, list) and all(
            any(allowed(value, candidate) for candidate in available) for value in requested
        )
    return requested == available


def sign(root):
    root = pathlib.Path(root).resolve()
    assert hashlib.sha256((root / "unsigned-archive.tar.gz").read_bytes()).hexdigest() == EXPECTED_ARCHIVE_SHA
    receipt = json.loads((root / "receipt.json").read_text())
    assert receipt["source"] == EXPECTED_SOURCE and receipt["ios_tree"] == EXPECTED_IOS_TREE
    assert receipt["build"] == "117" and receipt["signed"] is False
    archive = root / "Blankmind.xcarchive"
    app = archive / "Products/Applications/Blank.app"
    for name, digest in receipt["files"].items():
        target = (app / name).resolve()
        assert target.is_relative_to(app.resolve())
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, "Unsigned artifact changed: " + name
    identities = run("security", "find-identity", "-v", "-p", "codesigning").decode()
    identity = re.search(r'([A-F0-9]{40}) "(Apple Distribution:[^\n]+\(' + TEAM + r'\))"', identities)
    assert identity, "Existing distribution identity unavailable"
    certificate, certificate_name = identity.groups()
    profiles = []
    for directory in ["Library/MobileDevice/Provisioning Profiles", "Library/Developer/Xcode/UserData/Provisioning Profiles"]:
        for file in (pathlib.Path.home() / directory).glob("*.mobileprovision"):
            try:
                profile = plistlib.loads(run("security", "cms", "-D", "-i", str(file)))
                ent = profile["Entitlements"]
                if ent.get("com.apple.developer.team-identifier") != TEAM or ent.get("get-task-allow") is not False:
                    continue
                if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
                    continue
                if profile["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
                    continue
                if certificate not in [hashlib.sha1(c).hexdigest().upper() for c in profile["DeveloperCertificates"]]:
                    continue
                profiles.append((file, profile))
            except (subprocess.CalledProcessError, ValueError, KeyError):
                continue
    mapping, proof = {}, []
    bundles = sorted((app / "PlugIns").glob("*.appex")) + [app]
    for bundle in bundles:
        info = plistlib.loads((bundle / "Info.plist").read_bytes())
        assert info["CFBundleVersion"] == "117" and info["CFBundleShortVersionString"] == "1.9"
        requested = plistlib.loads((root / ("main.entitlements" if bundle == app else bundle.stem + ".entitlements")).read_bytes())
        if "aps-environment" in requested:
            requested["aps-environment"] = "production"
        candidates = [(file, p) for file, p in profiles
                      if p["Entitlements"].get("application-identifier", "").endswith("." + info["CFBundleIdentifier"])
                      and all(allowed(v, p["Entitlements"].get(k)) for k, v in requested.items())]
        assert candidates, "No approved distribution profile authorizes " + info["CFBundleIdentifier"]
        profile_file, profile = max(candidates, key=lambda item: item[1]["ExpirationDate"])
        ent = profile["Entitlements"]
        requested.update({"application-identifier": ent["application-identifier"],
                          "com.apple.developer.team-identifier": TEAM, "get-task-allow": False})
        keychain_group = profile["ApplicationIdentifierPrefix"][0] + "." + info["CFBundleIdentifier"]
        assert allowed([keychain_group], ent.get("keychain-access-groups", []))
        requested["keychain-access-groups"] = [keychain_group]
        ent_file = root / (bundle.stem + ".distribution.xcent")
        ent_file.write_bytes(plistlib.dumps(requested))
        shutil.copyfile(profile_file, bundle / "embedded.mobileprovision")
        for framework in sorted((bundle / "Frameworks").glob("*")):
            if framework.suffix in (".framework", ".dylib"):
                run("codesign", "--force", "--sign", certificate, "--timestamp=none", str(framework))
        run("codesign", "--force", "--sign", certificate, "--entitlements", str(ent_file),
            "--generate-entitlement-der", "--timestamp=none", str(bundle))
        run("codesign", "--verify", "--deep", "--strict", str(bundle))
        actual = plistlib.loads(run("codesign", "-d", "--entitlements", ":-", str(bundle)))
        assert all(actual.get(k) == v for k, v in requested.items())
        mapping[info["CFBundleIdentifier"]] = profile["Name"]
        proof.append({"bundle": info["CFBundleIdentifier"], "profile": profile["UUID"],
                      "expires": str(profile["ExpirationDate"]), "entitlements": actual, "signature_valid": True})
    archive_info = plistlib.loads((archive / "Info.plist").read_bytes())
    archive_info["ApplicationProperties"].update({"SigningIdentity": certificate_name, "Team": TEAM})
    (archive / "Info.plist").write_bytes(plistlib.dumps(archive_info))
    options = {"method": "app-store-connect", "destination": "upload", "teamID": TEAM,
               "signingStyle": "manual", "signingCertificate": certificate,
               "provisioningProfiles": mapping, "manageAppVersionAndBuildNumber": False,
               "testFlightInternalTestingOnly": False}
    (root / "ExportOptions.plist").write_bytes(plistlib.dumps(options))
    (root / "signing-receipt.json").write_text(json.dumps({"source": receipt["source"], "ios_tree": receipt["ios_tree"],
        "build": "117", "signed": True, "uploaded": False, "certificate_sha1": certificate, "bundles": proof}, indent=2))
    print("SIGNATURE_VALID 1.9(117): main and four extensions; approved usage and Health background; production/no QA cookie")


if __name__ == "__main__":
    try:
        sign(sys.argv[1])
    except subprocess.CalledProcessError as error:
        print("signing_failed: " + error.stderr.decode(errors="replace"), file=sys.stderr)
        raise SystemExit(1)
