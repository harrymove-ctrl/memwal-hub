# Chat UI audit

Pilot: project select, conversation list, live chat, memory review. Not a whole-app redesign.

Baseline defect from the chat screenshot: each conversation row put Rename and Archive beside the title, so a long title wrapped inside a 220px column.

Decision: the list is 280px. The title is one line with ellipsis and a `title` tooltip. Rename and Archive sit in one `Actions for <title>` menu. Rename has Save title and Cancel. Archive still only hides the chat.

The message column stays `min(760px, 100% - 32px)`, inside the 680–840px reading target. Hide chats / Show chats collapses the list. Below 768px the list is a block above the thread, at most 220px tall, and can be hidden.

Suggested facts already wrap (`overflow-wrap: anywhere`). Save still uses `/discovery/memories`. No new Walrus write was made for screenshots.

Not measured in a browser this pass: WCAG contrast numbers, 200% zoom, and a physical IME. Keyboard coverage is the existing Enter / Shift+Enter / menu buttons, plus the new menu.

Not migrated: Inbox, templates, canvas, and the marketing landing page.
