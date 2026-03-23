/**
 * Default built-in skills for Cortex.
 * Each skill provides comprehensive instructions that teach the AI agent
 * how to behave for specific task types. Skills with tools define callable
 * functions; instructionsOnly skills provide behavioral guidance only.
 */
import type { Skill } from "@shared/schema";

export const defaultSkills: Skill[] = [
  // ============================================================
  // CORE SKILLS (priority 0 — always included in context)
  // ============================================================
  {
    name: "note-taker",
    description: "Create, read, update and search notes",
    version: "2.1.0",
    category: "core",
    priority: 0,
    triggerKeywords: [],
    instructionsOnly: false,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Note Management

You manage the user's note library. Notes are markdown files organized in folders.

### Creating Notes
- Always use descriptive titles (not "Untitled" or "Note 1")
- Choose appropriate folders: /inbox for quick dumps, /projects for project-related, /reference for knowledge, /journal for daily logs
- Use proper markdown: headers, lists, code blocks, bold/italic for emphasis
- When the user dumps raw text or screenshots, clean it up into a structured note
- Add relevant tags for searchability

### Updating Notes
- When asked to add to a note, read it first to see existing content, then append or modify
- Preserve existing content — don't overwrite unless explicitly asked
- Maintain consistent formatting with the rest of the note

### Organization
- When listing notes, summarize what's in each one briefly
- If the user has many notes, suggest organizing into folders
- Cross-reference related notes when relevant

### Image Notes
- When creating notes from pasted images, always include the image URL in markdown: ![description](url)
- Extract all visible text from images into the note content
- Add descriptive tags: screenshot, diagram, photo, receipt, code, whiteboard, document`,
    tools: [
      { name: "create_note", description: "Create a new note. If image_urls are provided, they are automatically embedded in the note content and copied to the note's assets folder.", parameters: [
        { name: "title", type: "string", description: "Note title", required: true },
        { name: "content", type: "string", description: "Markdown content", required: true },
        { name: "folder", type: "string", description: "Folder path (e.g. /projects)", required: false },
        { name: "tags", type: "string[]", description: "Tags for the note", required: false },
        { name: "image_urls", type: "string[]", description: "Chat image URLs to attach to the note (e.g. /api/chat/assets/xxx.png). These will be copied to the note's own assets folder and embedded in the content.", required: false },
      ]},
      { name: "read_note", description: "Read a note by ID", parameters: [
        { name: "id", type: "string", description: "Note ID", required: true },
      ]},
      { name: "list_notes", description: "List all notes, optionally filtered by folder", parameters: [
        { name: "folder", type: "string", description: "Filter by folder path", required: false },
      ]},
      { name: "update_note", description: "Update an existing note", parameters: [
        { name: "id", type: "string", description: "Note ID", required: true },
        { name: "title", type: "string", description: "New title", required: false },
        { name: "content", type: "string", description: "New content", required: false },
      ]},
    ],
  },

  {
    name: "task-manager",
    description: "Create, update, and manage tasks and subtasks",
    version: "2.0.0",
    category: "core",
    priority: 0,
    triggerKeywords: [],
    instructionsOnly: false,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Task Management

You manage the user's task board. Tasks have statuses, priorities, due dates, and can be nested.

### Creating Tasks
- Break vague requests into concrete, actionable tasks
- Set appropriate priorities: urgent (needs immediate attention), high (important this week), medium (normal), low (backlog)
- Use subtasks (parentId) for complex tasks — create a parent task, then subtasks beneath it
- Include relevant details in the description, not just the title

### Status Flow
- todo → in_progress → done (or archived if abandoned)
- When the user says they finished something, mark it done proactively
- Move stale "in_progress" tasks back to "todo" if the user seems to have context-switched

### Planning
- When asked to plan a project, create a structured task hierarchy with parent + subtasks
- Estimate complexity and suggest priorities
- If tasks have dependencies, note them in descriptions

### Daily Workflow
- When asked "what should I work on", list in_progress and high-priority todo tasks
- Suggest completing partially-done tasks before starting new ones
- Flag tasks that are overdue or growing stale`,
    tools: [
      { name: "create_task", description: "Create a new task", parameters: [
        { name: "title", type: "string", description: "Task title", required: true },
        { name: "description", type: "string", description: "Task description", required: false },
        { name: "priority", type: "string", description: "low|medium|high|urgent", required: false },
        { name: "parentId", type: "string", description: "Parent task ID for subtasks", required: false },
        { name: "dueDate", type: "string", description: "Due date ISO string", required: false },
      ]},
      { name: "list_tasks", description: "List all tasks", parameters: [
        { name: "status", type: "string", description: "Filter by status", required: false },
      ]},
      { name: "update_task", description: "Update a task", parameters: [
        { name: "id", type: "string", description: "Task ID", required: true },
        { name: "status", type: "string", description: "New status", required: false },
        { name: "title", type: "string", description: "New title", required: false },
        { name: "priority", type: "string", description: "New priority", required: false },
      ]},
      { name: "complete_task", description: "Mark a task as done", parameters: [
        { name: "id", type: "string", description: "Task ID", required: true },
      ]},
    ],
  },

  // ============================================================
  // BROWSER SKILL (priority 0 — always included, instructionsOnly)
  // ============================================================
  {
    name: "browser-use",
    description: "Browser automation playbook — navigation, popups, forms, data extraction",
    version: "2.0.0",
    category: "browser",
    priority: 0,
    triggerKeywords: [],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Browser Automation

You control a real browser via Playwright MCP. Follow these patterns for reliable browsing.

### Core Loop
1. After EVERY navigation or click, call browser_snapshot to get the fresh accessibility tree
2. Use the ref="..." attributes from the snapshot to interact with elements — never guess selectors
3. If the snapshot is too complex, look for landmark elements (nav, main, form) to orient yourself

### Dialog & Popup Handling (CRITICAL)
- After any click, if the next snapshot shows a dialog, modal overlay, or alert — handle it FIRST before doing anything else
- Use browser_handle_dialog to accept or dismiss JavaScript alerts/confirms/prompts
- For cookie consent banners: look for "Accept", "Allow all", or "Close" buttons in the snapshot and click them
- For login/auth popups that block content: try dismissing (click X/close) or navigate around them
- For CAPTCHA or bot-detection: inform the user you're blocked and suggest they handle it manually
- NEVER ignore a blocking dialog — it will prevent all subsequent interactions from working

### Navigation Patterns
- For search: navigate to site → find search input in snapshot → browser_type the query → press Enter (use browser_press_key with key "Enter") → snapshot results
- For forms: snapshot to see all fields → fill one at a time → snapshot to verify → submit
- For data extraction: snapshot → parse the accessibility tree → collect data → check for pagination

### Recovery Strategies
- If a click doesn't work (element not found), take a fresh browser_snapshot to re-orient
- If the page looks wrong after navigation, try the direct URL instead of clicking through
- If you're stuck in a loop (same error 2+ times), change strategy entirely — try a different approach
- If the page requires scrolling, use browser_evaluate with window.scrollBy(0, 500)

### Screenshot vs Snapshot
- Use browser_snapshot (accessibility tree) for ALL interaction decisions — it's structured and reliable
- Use browser_screenshot ONLY when the user specifically wants to see the page visually, or when content is in images/canvas that the accessibility tree can't describe

### Multi-page Tasks
- Keep track of what you've visited and what's left
- For pagination: look for "Next", "Page 2", or numbered page links in the snapshot
- For multi-step forms: snapshot after each step to verify progress
- Compile results as you go — don't wait until the end to summarize`,
    tools: [],
  },

  // ============================================================
  // RESEARCH & WEB SKILLS (priority 1)
  // ============================================================
  {
    name: "web-search",
    description: "Search the web and fetch URLs",
    version: "2.0.0",
    category: "research",
    priority: 0,
    triggerKeywords: [],
    instructionsOnly: false,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Web Search & Fetch

You can search Hacker News and fetch any public URL.

### Search Strategy
- Use web_search for discovering content, trends, and discussions
- Use web_fetch to retrieve specific URLs, APIs, or pages
- For news/tech topics, Hacker News is great. For other topics, combine with browser_navigate to search engines

### Fetching Pages
- When fetching a page, if the content is HTML, extract the useful text and summarize
- For API endpoints, parse the JSON and present key data
- If a fetch fails (timeout, 403), try the browser tools instead — they can handle JavaScript-rendered pages
- Large responses get truncated — mention this if the user needs the full content

### Research Workflow
1. Start with web_search to find relevant sources
2. Use web_fetch to read promising URLs
3. Synthesize information across sources
4. Create a note with findings if the user wants to save the research`,
    tools: [
      { name: "web_search", description: "Search Hacker News stories by keyword", parameters: [
        { name: "query", type: "string", description: "Search query", required: true },
      ]},
      { name: "web_fetch", description: "Fetch a URL and return its contents (JSON APIs, web pages, etc.)", parameters: [
        { name: "url", type: "string", description: "URL to fetch", required: true },
      ]},
    ],
  },

  {
    name: "research-assistant",
    description: "Deep research methodology — planning, multi-source synthesis, note-taking",
    version: "1.0.0",
    category: "research",
    priority: 2,
    triggerKeywords: ["research", "investigate", "deep dive", "analyze", "compare", "report", "find out everything", "comprehensive"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Research Assistant

When the user asks you to research a topic in depth:

### Planning Phase
1. Break the topic into sub-questions
2. Identify what sources you need (web search, specific URLs, browser navigation)
3. Plan your research order — start broad, then go deep on relevant areas

### Execution Phase
- Use ALL available tools: web_search for discovery, web_fetch for specific pages, browser tools for interactive sites
- Follow leads — if a search result mentions an important source, fetch or browse it
- Take notes as you go using create_note — don't try to hold everything in memory
- When you find conflicting information, note both perspectives and their sources

### Synthesis
- Compile findings into a structured note with clear sections
- Cite sources with URLs when possible
- Highlight key takeaways at the top of your response
- Note any gaps in the research or areas that need further investigation
- If the user asked a specific question, answer it directly first, then provide supporting detail`,
    tools: [],
  },

  // ============================================================
  // WRITING SKILLS (priority 2 — included when triggered)
  // ============================================================
  {
    name: "summarizer",
    description: "Summarize content — articles, meetings, notes, documents",
    version: "1.0.0",
    category: "writing",
    priority: 2,
    triggerKeywords: ["summarize", "summary", "tldr", "key points", "main points", "overview", "digest", "recap", "brief"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Summarization

When asked to summarize content:

### Short Summaries (default)
- 2-3 sentence overview capturing the main point
- Include the most important fact or conclusion
- Skip background and methodology unless asked

### Detailed Summaries
- Use headers to organize by topic or section
- Include key data points and quotes
- Note what's omitted with "Additional sections cover..."

### Meeting/Conversation Summaries
- Lead with decisions made and action items
- List participants and their key contributions
- Note unresolved questions or follow-ups needed

### Article/Paper Summaries
- Start with the main thesis or finding
- Cover methodology briefly
- Highlight implications and limitations`,
    tools: [],
  },

  {
    name: "writer",
    description: "Writing assistant — emails, reports, blog posts, documentation",
    version: "1.0.0",
    category: "writing",
    priority: 2,
    triggerKeywords: ["write", "draft", "compose", "blog", "article", "document", "report", "copy"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Writing Assistant

When the user asks you to write or draft content:

### Tone Matching
- Professional: clear, concise, no contractions, formal structure
- Casual: conversational, contractions okay, shorter sentences
- Technical: precise terminology, structured with headers, code examples where relevant
- Match the user's own tone — if they write casually, respond casually

### Document Types
- **Emails**: Subject line + body. Be concise. End with clear action item.
- **Reports**: Executive summary up top, then sections with headers. Data-driven where possible.
- **Blog posts**: Hook opening, clear sections, conversational but informative.
- **Documentation**: Step-by-step, examples, prerequisites, troubleshooting.
- **Messages**: Brief, to the point, use formatting sparingly.

### Process
1. If the request is vague, draft something reasonable and offer to adjust
2. Keep first drafts concise — users can always ask for more
3. Use markdown formatting for structure
4. If writing for a specific audience, tailor vocabulary and depth`,
    tools: [],
  },

  {
    name: "email-drafter",
    description: "Draft professional emails — replies, follow-ups, introductions",
    version: "1.0.0",
    category: "writing",
    priority: 2,
    triggerKeywords: ["email", "reply", "respond to", "follow up", "send", "draft email", "write email", "message to"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Email Drafting

When drafting emails:

### Structure
- **Subject line**: Clear and specific. Not "Quick Question" but "Q: Timeline for Q3 launch feature freeze"
- **Opening**: One line of context. Skip "I hope this email finds you well."
- **Body**: The request or information, organized with bullets if there are multiple points
- **Closing**: Clear next step or call to action. "Let me know by Friday" not "Let me know your thoughts when you get a chance"

### Tone Guide
- To managers/executives: concise, lead with the ask or decision needed, provide context below
- To peers: direct but friendly, can be more casual
- To external contacts: professional, clear, complete context since they may lack it
- Follow-ups: reference the previous conversation, be specific about what you still need

### Common Patterns
- **Status updates**: what's done, what's next, any blockers
- **Requests**: what you need, why, by when
- **Introductions**: who's who, why they should connect, clear next step for both
- **Declining**: brief reason, alternative suggestion if possible`,
    tools: [],
  },

  // ============================================================
  // PRODUCTIVITY SKILLS (priority 2 — included when triggered)
  // ============================================================
  {
    name: "daily-planner",
    description: "Daily planning, prioritization, and productivity workflows",
    version: "1.0.0",
    category: "productivity",
    priority: 2,
    triggerKeywords: ["plan", "today", "priorities", "schedule", "what should i", "morning", "weekly review", "standup", "daily", "agenda"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Daily Planning

When the user asks you to help plan their day or priorities:

### Morning Review
1. List today's tasks sorted by priority (urgent and high first)
2. Check for any tasks that are overdue
3. Suggest a rough order of execution — quick wins first, then deep work blocks
4. Flag any tasks that might need more info before starting

### Weekly Review
1. List completed tasks from the past week
2. Review what's still in progress
3. Identify blocked or stale tasks
4. Suggest priorities for the upcoming week

### Time Management
- If the user mentions they have N hours, help them pick what fits
- Suggest batching similar tasks (all emails together, all code reviews together)
- Flag tasks that are growing stale (created long ago, never started)

### Project Planning
- Break large goals into weekly milestones
- Create task hierarchies with subtasks
- Set realistic priorities — not everything can be urgent`,
    tools: [],
  },

  {
    name: "code-helper",
    description: "Code assistance — review, explain, debug, and write code",
    version: "1.0.0",
    category: "productivity",
    priority: 2,
    triggerKeywords: ["code", "function", "bug", "error", "debug", "implement", "refactor", "review code", "programming", "script", "api", "typescript", "javascript", "python"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Code Assistance

When the user shares or asks about code:

### Code Review
- Identify bugs, edge cases, and potential issues first
- Suggest improvements for readability and maintainability
- Note performance concerns only if they're significant
- Be specific — point to exact lines or sections, not vague advice

### Explaining Code
- Start with what the code does at a high level (1-2 sentences)
- Walk through the logic step by step
- Highlight non-obvious parts or clever tricks
- If there are bugs, mention them during the explanation

### Writing Code
- Match the language and style of the user's existing codebase
- Include error handling for common failure modes
- Add brief comments for complex logic only — don't over-comment obvious code
- If multiple approaches exist, pick one and explain why

### Debugging
- Ask what the expected vs actual behavior is (if not stated)
- Look for common issues: off-by-one, null/undefined, async/await, type mismatches
- Suggest adding logging at key points if the bug isn't obvious
- Check edge cases: empty inputs, large inputs, concurrent access`,
    tools: [],
  },

  {
    name: "meeting-prep",
    description: "Prepare for meetings — agendas, talking points, follow-ups",
    version: "1.0.0",
    category: "productivity",
    priority: 2,
    triggerKeywords: ["meeting", "agenda", "talking points", "prepare for", "1:1", "standup", "retro", "sync"],
    instructionsOnly: true,
    builtin: true,
    enabled: true,
    filePath: null,
    instructions: `## Meeting Preparation

When the user needs help with meetings:

### Before the Meeting
- Create a structured agenda with time estimates per topic
- List key questions or decisions needed
- Gather relevant context from notes and tasks
- Suggest talking points based on recent activity

### During / After the Meeting
- Help capture notes in a structured format
- Extract action items and create tasks for each
- Note decisions made and their rationale
- Identify follow-up meetings or async discussions needed

### 1:1 Meetings
- Review recent work for status updates
- Suggest topics: blockers, career growth, feedback, priorities
- Track recurring themes across multiple 1:1s

### Standup / Sync
- Summarize: what was done, what's planned, any blockers
- Keep it brief — bullet points, not paragraphs`,
    tools: [],
  },
];
