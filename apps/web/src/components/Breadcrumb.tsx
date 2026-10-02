import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export default function Breadcrumb({ trail, current }: { trail: { slug: string; name: string }[]; current?: string }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Home</Link>
      {trail.map((c) => (
        <Fragment key={c.slug}>
          {' › '}
          <Link to={`/c/${c.slug}`}>{c.name}</Link>
        </Fragment>
      ))}
      {current && <> › {current}</>}
    </nav>
  );
}
