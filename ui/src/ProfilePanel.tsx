import type { UserProfile } from "../../src/profile/types.js";
import { Field, SectionCard, pushItem, updateArrayItem } from "./uiUtils.js";

interface ProfilePanelProps {
  profile: UserProfile;
  notice: { type: "success" | "error"; message: string } | null;
  onChange: (profile: UserProfile) => void;
  onSave: () => void;
}

export function ProfilePanel(props: ProfilePanelProps) {
  const { profile } = props;

  const setProfile = (updater: (current: UserProfile) => UserProfile) => {
    props.onChange(updater(structuredClone(profile)));
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div>
          <h2>Profile</h2>
          <p className="muted">Ten onboarding sections covering the fields common job forms ask for.</p>
        </div>
        <button className="button primary" type="button" onClick={props.onSave}>
          Save Profile
        </button>
      </div>
      {props.notice ? <div className={`notice ${props.notice.type}`}>{props.notice.message}</div> : null}

      <SectionCard title="Personal Information">
        <div className="section-grid">
          <Field label="First name" htmlFor="personal.firstName">
            <input
              id="personal.firstName"
              value={profile.personal.firstName}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, firstName: event.target.value } }))}
            />
          </Field>
          <Field label="Last name" htmlFor="personal.lastName">
            <input
              id="personal.lastName"
              value={profile.personal.lastName}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, lastName: event.target.value } }))}
            />
          </Field>
          <Field label="Preferred name" htmlFor="personal.preferredName">
            <input
              id="personal.preferredName"
              value={profile.personal.preferredName ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, preferredName: event.target.value } }))}
            />
          </Field>
          <Field label="Email address" htmlFor="personal.email">
            <input
              id="personal.email"
              type="email"
              value={profile.personal.email}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, email: event.target.value } }))}
            />
          </Field>
          <Field label="Phone number" htmlFor="personal.phone">
            <input
              id="personal.phone"
              value={profile.personal.phone}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, phone: event.target.value } }))}
            />
          </Field>
          <Field label="Street address">
            <input
              value={profile.personal.address}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, address: event.target.value } }))}
            />
          </Field>
          <Field label="City">
            <input
              value={profile.personal.city}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, city: event.target.value } }))}
            />
          </Field>
          <Field label="Province/State">
            <input
              value={profile.personal.province}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, province: event.target.value } }))}
            />
          </Field>
          <Field label="Country">
            <input
              value={profile.personal.country}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, country: event.target.value } }))}
            />
          </Field>
          <Field label="Postal/Zip code">
            <input
              value={profile.personal.postalCode}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, postalCode: event.target.value } }))}
            />
          </Field>
          <Field label="LinkedIn URL">
            <input
              value={profile.personal.linkedin}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, linkedin: event.target.value } }))}
            />
          </Field>
          <Field label="GitHub URL">
            <input
              value={profile.personal.github ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, github: event.target.value } }))}
            />
          </Field>
          <Field label="Portfolio URL">
            <input
              value={profile.personal.portfolio ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, personal: { ...current.personal, portfolio: event.target.value } }))}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Work Authorization">
        {profile.workAuthorization.map((entry, index) => (
          <div className="section-grid" key={`${entry.country}-${index}`}>
            <Field label="Country">
              <input
                value={entry.country}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    workAuthorization: updateArrayItem(current.workAuthorization, index, { ...entry, country: event.target.value })
                  }))
                }
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={entry.authorized}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    workAuthorization: updateArrayItem(current.workAuthorization, index, { ...entry, authorized: event.target.checked })
                  }))
                }
              />
              Authorized to work
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={entry.requiresSponsorship}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    workAuthorization: updateArrayItem(current.workAuthorization, index, {
                      ...entry,
                      requiresSponsorship: event.target.checked
                    })
                  }))
                }
              />
              Requires sponsorship
            </label>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            setProfile((current) => ({
              ...current,
              workAuthorization: pushItem(current.workAuthorization, {
                country: "",
                authorized: false,
                requiresSponsorship: true
              })
            }))
          }
        >
          Add authorization entry
        </button>
      </SectionCard>

      <SectionCard title="Employment Preferences">
        <div className="checkbox-grid">
          {["full-time", "part-time", "contract", "internship", "co-op"].map((jobType) => (
            <label className="checkbox" key={jobType}>
              <input
                type="checkbox"
                checked={profile.preferences.jobTypes.includes(jobType as UserProfile["preferences"]["jobTypes"][number])}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      jobTypes: event.target.checked
                        ? pushItem(current.preferences.jobTypes, jobType as UserProfile["preferences"]["jobTypes"][number])
                        : current.preferences.jobTypes.filter((entry) => entry !== jobType)
                    }
                  }))
                }
              />
              {jobType}
            </label>
          ))}
        </div>
        <div className="section-grid">
          <Field label="Earliest available start date">
            <input
              type="date"
              value={profile.preferences.earliestStartDate}
              onChange={(event) => setProfile((current) => ({ ...current, preferences: { ...current.preferences, earliestStartDate: event.target.value } }))}
            />
          </Field>
          <Field label="Remote preference">
            <select
              value={profile.preferences.remotePreference}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  preferences: { ...current.preferences, remotePreference: event.target.value as UserProfile["preferences"]["remotePreference"] }
                }))
              }
            >
              <option value="remote">remote</option>
              <option value="hybrid">hybrid</option>
              <option value="on-site">on-site</option>
              <option value="no preference">no preference</option>
            </select>
          </Field>
          <Field label="Salary expectation">
            <input
              value={profile.preferences.salaryExpectation ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, preferences: { ...current.preferences, salaryExpectation: event.target.value } }))}
            />
          </Field>
          <Field label="Salary currency">
            <input
              value={profile.preferences.salaryCurrency ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, preferences: { ...current.preferences, salaryCurrency: event.target.value } }))}
            />
          </Field>
          <Field label="Notice period">
            <select
              value={profile.preferences.noticePeriod ?? ""}
              onChange={(event) => setProfile((current) => ({ ...current, preferences: { ...current.preferences, noticePeriod: event.target.value } }))}
            >
              <option value="">Select…</option>
              <option value="immediately available">immediately</option>
              <option value="2 weeks">2 weeks</option>
              <option value="1 month">1 month</option>
              <option value="3 months">3 months</option>
              <option value="other">other</option>
            </select>
          </Field>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={profile.preferences.willingToRelocate}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  willingToRelocate: event.target.checked,
                  relocationCities: event.target.checked ? current.preferences.relocationCities ?? [] : []
                }
              }))
            }
          />
          Willing to relocate
        </label>
        {profile.preferences.willingToRelocate ? (
          <Field label="Relocation cities">
            <input
              value={(profile.preferences.relocationCities ?? []).join(", ")}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  preferences: {
                    ...current.preferences,
                    relocationCities: event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean)
                  }
                }))
              }
            />
          </Field>
        ) : null}
      </SectionCard>

      <SectionCard title="Education">
        {profile.education.map((entry, index) => (
          <div className="section-grid" key={`education-${index}`}>
            <Field label="Degree type">
              <input value={entry.degree} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, degree: event.target.value }) }))} />
            </Field>
            <Field label="Field of study">
              <input value={entry.fieldOfStudy} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, fieldOfStudy: event.target.value }) }))} />
            </Field>
            <Field label="University name">
              <input value={entry.university} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, university: event.target.value }) }))} />
            </Field>
            <Field label="Graduation date">
              <input value={entry.graduationDate} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, graduationDate: event.target.value }) }))} />
            </Field>
            <Field label="GPA">
              <input value={entry.gpa ?? ""} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, gpa: event.target.value }) }))} />
            </Field>
            <Field label="GPA scale">
              <input value={entry.gpaScale ?? ""} onChange={(event) => setProfile((current) => ({ ...current, education: updateArrayItem(current.education, index, { ...entry, gpaScale: event.target.value }) }))} />
            </Field>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            setProfile((current) => ({
              ...current,
              education: pushItem(current.education, {
                degree: "",
                fieldOfStudy: "",
                university: "",
                graduationDate: "",
                gpa: "",
                gpaScale: "4.0"
              })
            }))
          }
        >
          Add education
        </button>
      </SectionCard>

      <SectionCard title="Work Experience">
        {profile.experience.map((entry, index) => (
          <div className="section-card" key={`experience-${index}`}>
            <div className="section-grid">
              <Field label="Job title">
                <input value={entry.title} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, title: event.target.value }) }))} />
              </Field>
              <Field label="Company">
                <input value={entry.company} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, company: event.target.value }) }))} />
              </Field>
              <Field label="Start date">
                <input value={entry.startDate} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, startDate: event.target.value }) }))} />
              </Field>
              <Field label="End date">
                <input value={entry.endDate} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, endDate: event.target.value }) }))} />
              </Field>
              <Field label="Location">
                <input value={entry.location} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, location: event.target.value }) }))} />
              </Field>
            </div>
            <Field label="Summary">
              <textarea value={entry.summary} onChange={(event) => setProfile((current) => ({ ...current, experience: updateArrayItem(current.experience, index, { ...entry, summary: event.target.value }) }))} />
            </Field>
            {entry.responsibilities.map((responsibility, responsibilityIndex) => (
              <Field label={`Responsibility ${responsibilityIndex + 1}`} key={`responsibility-${responsibilityIndex}`}>
                <input
                  value={responsibility}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      experience: updateArrayItem(current.experience, index, {
                        ...entry,
                        responsibilities: updateArrayItem(entry.responsibilities, responsibilityIndex, event.target.value)
                      })
                    }))
                  }
                />
              </Field>
            ))}
            <button
              className="button"
              type="button"
              onClick={() =>
                setProfile((current) => ({
                  ...current,
                  experience: updateArrayItem(current.experience, index, { ...entry, responsibilities: pushItem(entry.responsibilities, "") })
                }))
              }
            >
              Add responsibility
            </button>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            setProfile((current) => ({
              ...current,
              experience: pushItem(current.experience, {
                title: "",
                company: "",
                startDate: "",
                endDate: "",
                location: "",
                summary: "",
                responsibilities: [""]
              })
            }))
          }
        >
          Add experience
        </button>
      </SectionCard>

      <SectionCard title="Skills">
        {profile.skills.map((entry, index) => (
          <div className="section-grid" key={`skill-${index}`}>
            <Field label="Skill name">
              <input value={entry.name} onChange={(event) => setProfile((current) => ({ ...current, skills: updateArrayItem(current.skills, index, { ...entry, name: event.target.value }) }))} />
            </Field>
            <Field label="Years of experience">
              <input
                type="number"
                value={entry.yearsOfExperience ?? ""}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    skills: updateArrayItem(current.skills, index, {
                      ...entry,
                      yearsOfExperience: event.target.value ? Number(event.target.value) : undefined
                    })
                  }))
                }
              />
            </Field>
            <Field label="Proficiency level">
              <select
                value={entry.proficiencyLevel ?? ""}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    skills: updateArrayItem(current.skills, index, {
                      ...entry,
                      proficiencyLevel: event.target.value ? (event.target.value as NonNullable<typeof entry.proficiencyLevel>) : undefined
                    })
                  }))
                }
              >
                <option value="">Select…</option>
                <option value="beginner">beginner</option>
                <option value="intermediate">intermediate</option>
                <option value="advanced">advanced</option>
                <option value="expert">expert</option>
              </select>
            </Field>
          </div>
        ))}
        <button className="button" type="button" onClick={() => setProfile((current) => ({ ...current, skills: pushItem(current.skills, { name: "", yearsOfExperience: undefined, proficiencyLevel: undefined }) }))}>
          Add skill
        </button>
      </SectionCard>

      <SectionCard title="Languages">
        {profile.languages.map((entry, index) => (
          <div className="section-grid" key={`language-${index}`}>
            <Field label="Language name">
              <input value={entry.language} onChange={(event) => setProfile((current) => ({ ...current, languages: updateArrayItem(current.languages, index, { ...entry, language: event.target.value }) }))} />
            </Field>
            <Field label="Proficiency">
              <select
                value={entry.proficiency}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    languages: updateArrayItem(current.languages, index, { ...entry, proficiency: event.target.value as typeof entry.proficiency })
                  }))
                }
              >
                <option value="native">native</option>
                <option value="fluent">fluent</option>
                <option value="professional">professional</option>
                <option value="conversational">conversational</option>
                <option value="basic">basic</option>
              </select>
            </Field>
          </div>
        ))}
        <button className="button" type="button" onClick={() => setProfile((current) => ({ ...current, languages: pushItem(current.languages, { language: "", proficiency: "conversational" }) }))}>
          Add language
        </button>
      </SectionCard>

      <SectionCard title="References">
        {(profile.references ?? []).map((entry, index) => (
          <div className="section-grid" key={`reference-${index}`}>
            <Field label="Name">
              <input value={entry.name} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, name: event.target.value }) }))} />
            </Field>
            <Field label="Title">
              <input value={entry.title} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, title: event.target.value }) }))} />
            </Field>
            <Field label="Company">
              <input value={entry.company} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, company: event.target.value }) }))} />
            </Field>
            <Field label="Relationship">
              <input value={entry.relationship} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, relationship: event.target.value }) }))} />
            </Field>
            <Field label="Email">
              <input value={entry.email ?? ""} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, email: event.target.value }) }))} />
            </Field>
            <Field label="Phone">
              <input value={entry.phone ?? ""} onChange={(event) => setProfile((current) => ({ ...current, references: updateArrayItem(current.references ?? [], index, { ...entry, phone: event.target.value }) }))} />
            </Field>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            setProfile((current) => ({
              ...current,
              references: pushItem(current.references ?? [], {
                name: "",
                title: "",
                company: "",
                relationship: "",
                email: "",
                phone: ""
              })
            }))
          }
        >
          Add reference
        </button>
      </SectionCard>

      <SectionCard title="Demographic (Optional)">
        <div className="section-grid">
          <Field label="Veteran status">
            <select value={profile.demographic?.veteranStatus ?? ""} onChange={(event) => setProfile((current) => ({ ...current, demographic: { ...current.demographic, veteranStatus: event.target.value as NonNullable<UserProfile["demographic"]>["veteranStatus"] } }))}>
              <option value="not a veteran">not a veteran</option>
              <option value="veteran">veteran</option>
              <option value="prefer not to disclose">prefer not to disclose</option>
            </select>
          </Field>
          <Field label="Disability status">
            <select value={profile.demographic?.disabilityStatus ?? ""} onChange={(event) => setProfile((current) => ({ ...current, demographic: { ...current.demographic, disabilityStatus: event.target.value as NonNullable<UserProfile["demographic"]>["disabilityStatus"] } }))}>
              <option value="no disability">no disability</option>
              <option value="has disability">has disability</option>
              <option value="prefer not to disclose">prefer not to disclose</option>
            </select>
          </Field>
          <Field label="Ethnicity">
            <input value={profile.demographic?.ethnicity ?? ""} onChange={(event) => setProfile((current) => ({ ...current, demographic: { ...current.demographic, ethnicity: event.target.value } }))} />
          </Field>
          <Field label="Gender">
            <input value={profile.demographic?.gender ?? ""} onChange={(event) => setProfile((current) => ({ ...current, demographic: { ...current.demographic, gender: event.target.value } }))} />
          </Field>
          <Field label="Pronouns">
            <input value={profile.demographic?.pronouns ?? ""} onChange={(event) => setProfile((current) => ({ ...current, demographic: { ...current.demographic, pronouns: event.target.value } }))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Application Settings">
        <div className="checkbox-grid">
          {["formal", "conversational", "technical"].map((style) => (
            <label className="checkbox" key={style}>
              <input
                type="radio"
                name="coverLetterStyle"
                checked={profile.settings.coverLetterStyle === style}
                onChange={() => setProfile((current) => ({ ...current, settings: { ...current.settings, coverLetterStyle: style as UserProfile["settings"]["coverLetterStyle"] } }))}
              />
              {style}
            </label>
          ))}
        </div>
        <div className="section-grid">
          <Field label="Resume file path">
            <input value={profile.settings.resumePath} onChange={(event) => setProfile((current) => ({ ...current, settings: { ...current.settings, resumePath: event.target.value } }))} />
          </Field>
          <Field label="Default unknown answer">
            <select
              value={profile.settings.defaultAnswerForUnknown}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  settings: { ...current.settings, defaultAnswerForUnknown: event.target.value as UserProfile["settings"]["defaultAnswerForUnknown"] }
                }))
              }
            >
              <option value="leave blank">leave blank</option>
              <option value="prefer not to say">prefer not to say</option>
            </select>
          </Field>
        </div>
        <div className="checkbox-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.settings.stopBeforeSubmit}
              onChange={(event) => setProfile((current) => ({ ...current, settings: { ...current.settings, stopBeforeSubmit: event.target.checked } }))}
            />
            Stop before submit
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.settings.screenshotOnComplete}
              onChange={(event) => setProfile((current) => ({ ...current, settings: { ...current.settings, screenshotOnComplete: event.target.checked } }))}
            />
            Screenshot on completion
          </label>
        </div>
      </SectionCard>
    </div>
  );
}
