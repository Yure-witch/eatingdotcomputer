# Reply to the Guideline 1.2 rejection (2026-08-25)

Paste the reply text below into App Store Connect, attach the new
recording, and (optionally) bump the build number — no binary change is
required, all precautions are server-side and already live.

## What to record (one take, physical iPhone, ~60–90s)

1. **EULA at registration** — launch the app, tap "Create an account",
   scroll to the required "I agree to the Terms of Use" checkbox, tap the
   Terms link so the full terms page (with the zero-tolerance section) is
   visible for a beat, go back, tick the box, create a throwaway account
   (NOT the reviewer demo account).
2. **EULA at login** — sign out, sign in as `reviewer` /
   `EatingReview2026`: the "Before you continue" terms screen appears
   before the app loads (it is armed for this account). Read it a beat,
   tap "I agree to the Terms of Use".
3. **Flag content** — in the class channel, open a message's menu → Report
   → confirm.
4. **Block a user** — open one of that member's messages → Block → confirm;
   show their messages vanish from the channel instantly.
5. **(Optional, strengthens the reply)** — switch to the instructor
   account and show Manage → Moderation: the report AND the block both
   sitting in the queue, and Resolve on one of them.

## Reply text

Hello,

Thank you for the detailed review. All of the required Guideline 1.2
precautions for user-generated content are now implemented, and the
attached screen recording, captured on a physical iPhone, demonstrates
each one:

1. Terms of use (EULA) — Users must agree to the Terms of Use
(https://www.eating.computer/terms) before registering or logging in. The
terms state explicitly that there is no tolerance for objectionable
content or abusive users. Registration requires an "I agree to the Terms
of Use" checkbox; existing and OAuth users must accept the terms on a
dedicated screen immediately after signing in, before the app can be
used. Both appear in the recording.

2. Flagging objectionable content — Every message can be reported from
its own menu ("Report"). Reports go to the instructor's moderation queue
with a snapshot of the content and trigger a push notification to the
moderator. Shown in the recording.

3. Blocking abusive users — Every member can block any other member
("Block" in the message menu). Blocking removes the blocked user's
messages from the blocker's view instantly, suppresses their
notifications, and notifies the developer/moderator: each block files an
entry into the moderation queue with the message it was made from and
sends the moderator a push notification. Shown in the recording,
including the messages disappearing immediately.

4. Filtering and 24-hour moderation — The instructor's moderation queue
(Manage → Moderation, shown at the end of the recording) lists all
reports and blocks for review. Our published terms commit to acting on
reports within 24 hours by removing offending content and ejecting the
user who posted it; as a single-classroom platform with one moderator,
review in practice happens same-day.

The app remains a private classroom platform for one college course. The
demo account (reviewer / EatingReview2026) is unchanged and pre-enrolled
in the populated demonstration class.

Thank you again — happy to provide anything further.
