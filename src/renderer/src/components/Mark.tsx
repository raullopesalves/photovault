import iconUrl from '../../../../build/icon.svg?url'
import smallIconUrl from '../../../../build/icon-small.svg?url'

/**
 * The Photo Vault mark: a camera aperture whose opening is a keyhole. It is the app icon itself, using the icon's
 * own small drawing below 48 px so it stays crisp.
 */
export function Mark(props: { size?: number; className?: string }) {
  const size = props.size ?? 24
  return <img src={size >= 48 ? iconUrl : smallIconUrl} width={size} height={size} alt="Photo Vault" draggable={false} className={props.className} />
}
