import type React from "react";

export function updateArrayItem<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

export function pushItem<T>(items: T[], next: T): T[] {
  return [...items, next];
}

export function SectionCard(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="section-card">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

export function Field(props: React.PropsWithChildren<{ label: string; htmlFor?: string }>) {
  return (
    <label className="field" htmlFor={props.htmlFor}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}
