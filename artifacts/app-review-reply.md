# App Review reply — Guideline 2.1 (Information Needed)

Paste the numbered sections into the reply in App Store Connect, and copy the
same content into App Review Information → Notes for future submissions.
Items marked ⚠️ TODO need your real values before sending.

---

## 1. Screen recording

Record on a physical iPhone on the latest iOS (screen-record from Control
Center, or QuickTime via cable for a clean file). Suggested shot list, in
order — one continuous take is fine:

1. Launch the app from the home screen (cold start, show the icon being tapped).
2. Log in with the demo account (username + password on the login screen).
   Also show the "Continue with Google" button exists.
3. Allow the push-notification permission prompt when it appears (this is the
   only sensitive-capability prompt the app makes — no location, contacts,
   camera, or tracking).
4. Dashboard: scroll the assignment cards, open a week's assignment, show a
   submission form (link/image/video types).
5. Chat: open the class channel, send a message, add an emoji reaction, open
   the expression picker, send a GIF. Open a DM.
6. Files tab: show uploads and starred messages.
7. ⚠️ TODO — account deletion flow (see "Blocking gaps" at the bottom: this
   does not exist yet and must be built and shown).
8. ⚠️ TODO — content reporting + user blocking in chat (same: must be built
   and shown, since the app has user-generated content).

There are no purchases, subscriptions, or paid content — nothing to record
for those.

## 2. Devices and OS versions tested

⚠️ TODO — fill in your actual hardware, e.g.:
- iPhone [model], iOS [version] (physical device)
- iPhone [model] simulator, iOS [version]
- Desktop/mobile Safari and Chrome (the app is also offered as a web app)

## 3. What the app is, who it's for, and the value it provides

eating.computer is a private classroom companion app for a college design
course ("Interactive Design Concepts"). Its users are the enrolled students
and their instructor — it is not aimed at the general public, at children, or
at any regulated activity.

The problem it solves: course materials, weekly assignments, submissions, and
class discussion are usually scattered across an LMS, email, and a chat tool.
This app puts the full loop in one place:

- Week-by-week assignments with submission (links, images, video)
- Real-time class chat (channels and direct messages) with expressive
  typography, emoji reactions, replies, and threads
- File sharing and a personal collection of saved messages
- An opt-in AI assistant ("Gemma") that sends students a periodic digest of
  what they missed, upcoming deadlines, and links related to their stated
  interests
- Push notifications for mentions, replies, and DMs

Value: students see everything the course expects of them in one feed, and
the instructor manages assignments, enrollment, and class communication
without stitching together separate tools.

## 4. Setup and access instructions

- The app requires an account. Sign-in supports Google (OAuth) and
  username/password credentials.
- Demo account for review: username ⚠️ TODO / password ⚠️ TODO
  (pre-enrolled in a fully populated demonstration class with assignments,
  syllabus, and an active chat channel — no additional setup is needed; log
  in and every feature is reachable).
  ⚠️ TODO if you have a second (instructor-role) reviewer account, list it
  too: Apple asks for credentials for each account type.
- New public sign-ups require instructor approval before they see class
  content (the app serves a closed classroom), which is why the demo account
  is provided pre-approved.
- No sample files are required; the demo class already contains submissions,
  uploads, and chat history.

## 5. External services, tools, and platforms

- Google Sign-In (OAuth) and username/password via Auth.js — authentication
- Firebase Realtime Database (Google) — real-time chat message transport
- Turso (hosted SQLite) — primary application database
- Cloudflare R2 — user file/upload storage
- Vercel — application hosting
- Apple Push Notification service and Web Push — notifications
- Giphy API — GIF search in chat
- Self-hosted open-weights language model (Google's Gemma family) running on
  university infrastructure — generates the opt-in digest messages; no
  third-party AI API receives user data
  ⚠️ TODO — confirm this wording matches where the model actually runs
- Wikipedia and Are.na public APIs — fetching public links for the interest
  digest

No payment processors, no ad networks, no analytics SDKs, no tracking.

## 6. Regional differences

None. The app functions identically in all regions. Content is in English.

## 7. Regulated industry / protected material

Not applicable. The app is a private classroom tool for a single university
course. It does not operate in a regulated industry (no health, financial,
gambling, or similar services) and contains no protected third-party
material. All course content is authored by the instructor; all other content
is created by the enrolled students themselves.

---

# ⚠️ Blocking gaps to fix BEFORE resubmitting (not part of the reply)

Apple's template asks the recording to include these *if the app has accounts
and user-generated content*. It has both. Status:

1. ✅ **Content reporting — Guideline 1.2.** BUILT (2026-08-21): every message
   from another member has Report in its ⋮ menu (channels + DMs); reports are
   snapshotted to the database, instructors get a push notification, and
   review/resolve lives in Manage → Moderation. Show this in the recording:
   report a message, then show it appearing in Manage → Moderation.
2. **In-app account deletion — Guideline 5.1.1(v).** STILL MISSING. Any app
   that supports account creation must let users initiate account deletion
   inside the app. The privacy page currently says to ask the instructor;
   that does not satisfy the rule. Needs: a "Delete account" action
   (profile/settings) that deletes or schedules deletion of the account and
   its data.
3. **User blocking — Guideline 1.2.** STILL MISSING. UGC apps need a way to
   block abusive users, separate from reporting. Needs: "Block user" (hides
   that user's messages/DMs for the blocker).

Recommendation: build 2 and 3, capture all three in the screen recording,
then reply.
