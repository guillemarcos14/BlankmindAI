import runpy
import pathlib

allowed = runpy.run_path(str(pathlib.Path(__file__).with_name("ios_sign_existing_archive.py")))["allowed"]
assert allowed(["applinks:blankmind.ai", "applinks:blanked.app"], "*")
assert allowed(["GS54UV79RG.com.blanknfc.app.ios"], ["GS54UV79RG.*"])
assert allowed(["group.com.blanknfc.app.ios"], ["group.com.blanknfc.app.ios"])
assert allowed(["health-records"], ["health-records"])
assert allowed(True, True)
assert allowed(False, False)
assert not allowed(True, False)
assert not allowed(True, None)
assert not allowed(["group.unapproved"], ["group.com.blanknfc.app.ios"])
assert not allowed(["health-records"], [])
assert not allowed(["applinks:blankmind.ai"], "applinks:other.example")
print("Apple profile wildcard accepted; unapproved groups, Health, booleans and domains rejected")
