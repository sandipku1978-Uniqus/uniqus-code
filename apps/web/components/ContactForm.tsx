"use client";

import { useState } from "react";

const TOPICS = ["Sales", "Support", "Security", "Partnerships", "Other"] as const;
type Topic = (typeof TOPICS)[number];

const CONTACT_EMAIL = "hello@gate15.dev";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [topic, setTopic] = useState<Topic>("Sales");
  const [message, setMessage] = useState("");
  const [draftOpened, setDraftOpened] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const subject = `[${topic}] Message from ${name.trim() || "a visitor"}`;
    const bodyLines = [
      `Name: ${name.trim()}`,
      `Email: ${email.trim()}`,
      company.trim() ? `Company: ${company.trim()}` : null,
      `Topic: ${topic}`,
      "",
      message.trim(),
    ].filter((line): line is string => line !== null);

    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

    window.location.href = mailto;
    setDraftOpened(true);
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="contact-name">
            Name <span className="req">*</span>
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="contact-email">
            Email <span className="req">*</span>
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="contact-company">Company</label>
          <input
            id="contact-company"
            name="company"
            type="text"
            autoComplete="organization"
            placeholder="Optional"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="contact-topic">
            Topic <span className="req">*</span>
          </label>
          <select
            id="contact-topic"
            name="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value as Topic)}
          >
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="contact-message">
          Message <span className="req">*</span>
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          placeholder="Tell us what you're building and how we can help."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <button type="submit" className="btn-primary">
        Open email draft
      </button>
      {draftOpened && (
        <div className="form-ok" role="status">
          Your email app should open with a draft. Review it and press Send to
          contact us. Your completed form stays here in case the app did not open.
        </div>
      )}
      <p className="form-note">
        This opens your email client with the message pre-filled — no form data
        is stored on our servers. Prefer to write directly? Email{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          style={{ color: "var(--accent-text)" }}
        >
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </form>
  );
}
