import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, getPost } from "../posts";

export async function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) {
    return {
      title: "Post not found — Uniqus Code",
      description: "This post could not be found.",
    };
  }
  return {
    title: `${post.title} — Uniqus Code`,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <article>
      <div className="mk-page narrow" style={{ paddingBottom: 0 }}>
        <Link className="mk-back" href="/blog">
          &larr; All posts
        </Link>
      </div>

      <header className="mk-article-head">
        <span className="mk-eyebrow">
          <span className="dot" /> {post.tag}
        </span>
        <h1>{post.title}</h1>
        <p className="mk-lede">{post.excerpt}</p>
        <div
          style={{
            color: "var(--mk-dim)",
            fontFamily: "var(--font-mono-stack)",
            fontSize: 12,
            letterSpacing: "0.04em",
          }}
        >
          {post.author} &middot; {post.date} &middot; {post.readingTime}
        </div>
      </header>

      <div className="mk-article-body">
        <div className="mk-prose">
          {post.content.map((block, i) => {
            if (block.type === "h2") return <h2 key={i}>{block.text}</h2>;
            if (block.type === "ul") {
              return (
                <ul key={i}>
                  {(block.items ?? []).map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              );
            }
            return <p key={i}>{block.text}</p>;
          })}
        </div>
      </div>
    </article>
  );
}
