import Link from "next/link";
import { POSTS } from "./posts";

export const metadata = {
  title: "Blog — Gate 15",
  description:
    "Notes from the workshop: how Gate 15 thinks about building with AI — model choice, plan mode, private workspaces, web search, and shipping.",
};

export default function BlogPage() {
  const [feature, ...rest] = POSTS;

  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Blog
          </span>
          <h1>
            Notes from the <span className="grad">workshop</span>.
          </h1>
          <p className="mk-lede">
            How we think about building software with AI — the model choices, the
            guardrails, the infrastructure, and the small decisions that add up to
            a tool we&rsquo;d actually want to use.
          </p>
        </div>
      </section>

      <section className="mk-page wide">
        <div className="post-grid">
          {feature && (
            <Link
              href={`/blog/${feature.slug}`}
              className="post-card lead"
              key={feature.slug}
            >
              <div className={`post-thumb ${feature.thumb}`} />
              <div className="post-body">
                <div className="post-meta">
                  <span>{feature.tag}</span>
                  <span>{feature.date}</span>
                  <span>{feature.readingTime}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.excerpt}</p>
              </div>
            </Link>
          )}

          {rest.map((post) => (
            <Link
              href={`/blog/${post.slug}`}
              className="post-card"
              key={post.slug}
            >
              <div className={`post-thumb ${post.thumb}`} />
              <div className="post-body">
                <div className="post-meta">
                  <span>{post.tag}</span>
                  <span>{post.date}</span>
                  <span>{post.readingTime}</span>
                </div>
                <h3>{post.title}</h3>
                <p>{post.excerpt}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
