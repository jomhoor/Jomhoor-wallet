# Jomhoor version 0 cleanup

- dead-ends in the first app run auth, if the user skips enabling PIN or
- replace dev UI text with prod text

## Localization

- Complete the English UI is necessary (localisation has many tiny issues)
- RTL issues and UI design bugs

## Profile

### Security

Profile/Advanced Shows a key.

- Should not be the private key
- If it is not then change the lable

## Documents

- Documents screen's back is navigating to the last page while it should explicitly navigate to Profile screen. I currently creates a loop.
- “Start scan” popup overlaps Android home/back buttons

## NIDC

- NIDC scan is mockup.
- NID: add NIDN validation. I can provide the function.

## Passport

Add a back button to scan passport screen.

## Proposals

### Navigation

Remove dead ends

- If the user is not verified and tap on one Proposal they are asked to Create Digital Identity with no back button. "Createe Digital Identity" button should lead to Profile/Documents.

## Hub

- Fix/remove login. It waits indefinitely.
- Hub should adopt the app's current theme.
- (optional) Make Hub fullscreen and add a floating back button.

## Compass:

- Compass should adopt the app's current theme.
- (optional) Make Compass fullscreen and add a floating back button.

---

---

---

---

---

# Jomhoor version 0.6 TODO

### Facial Comparison Integration

Refactor facial comparison workflow:

- Remove the separate taking picture step in the face comparison screen
- Add a final waypoint to the gaze challenge positioned at center (user faces directly at camera)
- Capture clean photo automatically at this final center waypoint (when user and theguiding face are aligned)
- Make it seamless - the final waypoint and photo capture should look like another gaze challenge waypoint, not a separate step
- User experience: instead of n waypoints, they react to n+1 waypoints
- Use the photo captured during this final gaze waypoint for face comparison instead of a dedicated screen for taking picture

### Gaze challenge

Throughout the gaze challenge there MUST be exactly 1 face in view - no less no more.

### Document Verification

Implement an NFC tool to log all of the raw data available on the chip to a file to be shared with the development team to add support for different kinds of passport.
This can be a menu item added to settings page -> dev screen with buttons to execute critical tasks.

**Buttons**

- NFC probe: calles native NFC probe and collects all of the data in a file provided to user to save/share.

### Map

Add Map to the home screen.
Reuse the map screen and data schema from iLand.
