# UI acceptance

Implementation check only. Not independent QA.

| Area | Result | Evidence | Remaining |
| --- | --- | --- | --- |
| Conversation navigation | PASS in unit tests | ChatPage.test.tsx opens Actions for New chat and finds Archive | Public click-through after this deploy |
| Mobile | PARTIAL | Local Chromium at 390×844: `documentElement.scrollWidth` equals `clientWidth` (390). Hide chats is present. Not a device keyboard test. | 768, 1440, and 200% zoom not captured |
| Header | UNCHANGED | Status pills and model select remain | Still dense on a phone |
| Memory review | PASS in unit tests | Button name includes "Save selected to project Memory" and the hint says the write is not automatic | No new Walrus write |
| Long titles | PASS in CSS and one render | Title is one line with ellipsis. Screenshot `~/memwal-qa/final-20261009/chat-1280.png` and `chat-390.png` | |
| Composer | UNCHANGED behavior | Enter sends in live chat; example composer does not | |
| Keyboard | PARTIAL | Menu items are buttons. Dialogs already return focus | 200% zoom not measured |
| Reduced motion | UNCHANGED | Existing `prefers-reduced-motion` rule still disables chat animations | |

Chat tests: 24 passed. `tsc -b` exit 0.
