# Known Issues

| Issue | What the app does |
|---|---|
| CAPTCHA appears | Stops the run, marks it `captcha_blocked`, records the note, and closes the session |
| Page does not load after Next click | The agent instruction tells Stagehand to wait 5 seconds, re-check the page, and retry once before marking `needs_review` |
| Dropdown options do not match profile | Selects the semantically closest option based on the system prompt |
| Required field not in profile or safe defaults | Reports `UNKNOWN_FIELD`, continues where possible, and marks the result `needs_review` |
| File upload for resume | Flags `RESUME_UPLOAD_REQUIRED`, skips upload, and surfaces it in the result/log panel |
| Multi-select checkbox question | Selects every applicable option from the saved profile |
| Date field format varies | Tells the agent to match the date format shown by the field |
| Phone number validation is strict | Uses the saved phone number and lets the agent adapt formatting to the field |
| Salary field rejects "open" | The safe-default guidance falls back to a discussion-oriented answer and may still require review |
| LinkedIn URL field | Uses the full saved URL from the profile |
| Application requires account creation | The agent is instructed to stop and return `needs_review` rather than creating an account |
