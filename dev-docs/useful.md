## In this setup, **Xcode itself is not the primary switch** for prod/dev.

The switch is `APP_ENV` when Expo prebuild/config runs.

Use this workflow:

1. Generate native iOS for production:

```bash
APP_ENV=production npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

2. Open `ios/*.xcworkspace` in Xcode and Archive.

For development:

```bash
APP_ENV=development npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

Then build/archive from Xcode.

Important points:

- If you skip prebuild, Xcode may archive stale native/config outputs from a previous env.
- So the env choice is effectively made **before** Xcode archive.

Quick verification after archive:

- `Jomhoor.app/EXConstants.bundle/app.config` should show `extra.APP_ENV`
- `Jomhoor.app/Info.plist` should show expected `CFBundleIdentifier` and ATS values.

# TODO

## Arman

- Enable voting for iranian NIDC and passport
- Replace Rarimo as much as we can
- ZK documentation

## Shooresh

- [x] NID visual scan
- [x] list of passports before visual scan
- [x] Flow chart data flow User-data schema
- [x] Include proof gen required data
- [x] Add a back button to selecet document page
- [ ] Refactor face verification - one livness screen - automate likeness

# Backlog

- After successful NIDC verification, "Home Page" button navigates back to "Create your digital identity" page. This creates a loop.
- Add the final waypoint at the center and take a photo to use in comparison.

## Team

- Add privacy policy document at `https://jomhoor.org/app/privacy.html`, including "User privacy choices".
-



# Next release

- App map
- support other types of NIDC
- Support more countries

