# eating.computer — North Star

This document defines the core vision and goals for the project. Refer to it when making decisions about scope and priorities.

---

## What This Is

A class platform for sharing course content, assignments, and communication — built as a Progressive Web App (PWA) hosted at eating.computer.

---

## Core Goals

### 1. Progressive Web App (PWA)
- The app must be installable on mobile and desktop
- Push notification support for students who install it
- Email reminder fallback for students who don't install or haven't enabled notifications

### 2. Notifications
- Students receive notifications for new assignments
- Students receive notifications for upcoming lectures or deadlines
- Both push (PWA) and email channels

### 3. Authentication & Access Model
- **Public side**: Visible to anyone, not installable — serves as the entry point / landing
- **Private side**: Requires login; once logged in, the PWA install prompt becomes available
- Students log in to access course content
- Instructor (you) has an admin/instructor role to post content

### 4. Content & Course Management (week-by-week)
- Assignments and homework: create, assign, and track on a per-week basis
- Lecture notes: share notes organized by week
- Files: upload and share files with the class

### 5. Chat
- A class chat app for student-instructor and student-student communication

### 6. Work Showcase
- A place to eventually display and share work produced by the class (public-facing)

---

## User Roles

| Role | Access |
|------|--------|
| Public visitor | Landing page only, no install prompt |
| Student (logged in) | Full PWA, chat, assignments, notes, files |
| Instructor | All student access + ability to post/assign/manage content |

---

## Tech Stack (current scaffold)
- **Framework**: SvelteKit
- **Database**: Turso (SQLite)
- **File storage**: Cloudflare R2
- **Fonts**: Custom Cambridge + Google Fonts
