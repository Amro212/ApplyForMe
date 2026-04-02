export const safeDefaultsPromptSection = `
=== SAFE DEFAULTS FOR COMMON APPLICATION QUESTIONS ===

Use these answers when the question is not covered by the candidate profile.
These are pre-approved defaults. Do not deviate from them.

LEGAL / BACKGROUND:
- "Are you 18 years of age or older?" -> Yes
- "Do you consent to a background check?" -> Yes
- "Do you consent to a criminal record check?" -> Yes
- "Do you consent to a credit check?" -> Yes (unless profile says otherwise)
- "Do you agree to a drug/substance test?" -> Yes
- "Do you agree to the terms and conditions?" -> Yes / Agree
- "Do you agree to the privacy policy?" -> Yes / Agree
- "Have you ever been convicted of a felony?" -> No
- "Are you legally eligible to enter into a contract?" -> Yes

LOGISTICS:
- "How did you hear about this role?" -> Online job board
- "Are you able to work the required hours?" -> Yes
- "Are you comfortable with the stated work schedule?" -> Yes
- "Do you have reliable transportation or can commute to this location?" -> Yes
- "Are you willing to travel for this role?" -> Yes, occasionally
- "Are you comfortable working in a fast-paced environment?" -> Yes
- "Are you a team player?" -> Yes
- "Can you work independently?" -> Yes
- "Are you comfortable with performance reviews?" -> Yes
- "Have you applied to this company before?" -> No (unless user specifies)

COMPENSATION:
- "What are your salary expectations?" -> Use salaryExpectation from profile, or if "open" -> "Open to discussion based on the full compensation package"
- "Are you comfortable with the listed salary range?" -> Yes
- "Are you negotiable on compensation?" -> Yes

TECHNICAL / ROLE-SPECIFIC:
- "Are you comfortable learning new tools and technologies?" -> Yes
- "Are you able to perform the essential functions of this job with or without accommodation?" -> Yes
- "Are you willing to undergo additional training?" -> Yes
- "Do you have access to a computer and reliable internet?" -> Yes

DEMOGRAPHIC:
- Veteran status -> "I am not a protected veteran" (or "prefer not to disclose" if profile says so)
- Disability status -> "I do not have a disability" (or "prefer not to disclose")
- Race / ethnicity -> "Decline to self-identify" (or "prefer not to disclose")
- Gender -> "Prefer not to disclose" (unless profile specifies)
- Pronouns -> Leave blank unless profile specifies
- Sexual orientation -> "Prefer not to disclose"

REFERENCES:
- "May we contact your current employer?" -> No
- "May we contact your references?" -> Yes
- "Do you have professional references available?" -> Yes

MISC:
- "Are you currently employed?" -> Answer based on profile experience (if last job has no end date, say Yes)
- "Are you currently a student?" -> Use graduation date from profile (if in future, say Yes)
- "Are you a recent graduate?" -> Yes if graduation is within 12 months
- "What is your notice period?" -> Use noticePeriod from profile
- "When are you available to start?" -> Use earliestStartDate from profile
`.trim();
