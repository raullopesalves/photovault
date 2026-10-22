/** The Photo Vault mark: a mount, its window set high, with a brass label below. Follows the theme. */
export function Mark(props: { size?: number; className?: string }) {
  const size = props.size ?? 24
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Photo Vault" className={props.className}>
      <path className="fill-ink" fillRule="evenodd" d="M8 0h48a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V8a8 8 0 0 1 8-8ZM14 12v26h36V12Z" />
      <rect className="fill-brass" x="24" y="46" width="16" height="5" rx="2.5" />
    </svg>
  )
}
