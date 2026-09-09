import { Bug, BookOpen, ExternalLink, Heart, Info, Lightbulb } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useTranslation } from '../../../i18n'
import { FEATURE_REQUEST_URL, HELP_HOME_PATH, REPORT_BUG_URL } from '../../../utils/repoLinks'
import { MSetCard } from './MSettingsUi'

interface AboutLink {
  /** External URL (opens in a new tab). */
  href?: string
  /** In-app route. */
  to?: string
  icon: LucideIcon
  title: string
  sub: string
}

/** "About" section — AboutTab parity as tappable link rows. */
export default function MSettingsAbout({ appVersion }: { appVersion: string }) {
  const { t } = useTranslation()

  // AboutTab parity: issue links go to this fork's own repository; docs go to
  // the in-app help (the bundled wiki matches the running version). Upstream's
  // funding/Discord rows are gone — this fork has neither.
  const links: AboutLink[] = [
    { href: REPORT_BUG_URL, icon: Bug, title: t('settings.about.reportBug'), sub: t('settings.about.reportBugHint') },
    { href: FEATURE_REQUEST_URL, icon: Lightbulb, title: t('settings.about.featureRequest'), sub: t('settings.about.featureRequestHint') },
    { to: HELP_HOME_PATH, icon: BookOpen, title: 'Wiki', sub: t('settings.about.wikiHint') },
  ]

  return (
    <MSetCard title={t('settings.about')} icon={Info}>
      <p className="text-[0.78125rem] leading-relaxed text-m-muted">{t('settings.about.description')}</p>
      <p className="mt-2 font-geist text-[0.6875rem] text-m-faint">
        {t('settings.about.madeWith')} <Heart size={10} className="inline-block align-[-1px] text-[color:var(--m-st-danger)]" />{' '}
        <span className="inline-flex items-center rounded-full bg-[color:var(--m-ic)] px-[7px] py-[1px] font-geist text-[0.625rem] font-bold text-m-muted align-[1px]">
          v{appVersion}
        </span>
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {links.map((link) =>
          link.to ? (
            <Link
              key={link.title}
              to={link.to}
              className="flex items-center gap-[13px] rounded-xl border border-[color:var(--m-rowbr)] bg-[color:var(--m-sheet)] px-[14px] py-3 no-underline"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[color:var(--m-ic)] text-m-ink">
                <link.icon size={19} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-bold text-m-ink">{link.title}</span>
                <span className="block font-geist text-[0.625rem] text-m-muted">{link.sub}</span>
              </span>
            </Link>
          ) : (
            <a
              key={link.title}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[13px] rounded-xl border border-[color:var(--m-rowbr)] bg-[color:var(--m-sheet)] px-[14px] py-3 no-underline"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[color:var(--m-ic)] text-m-ink">
                <link.icon size={19} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-bold text-m-ink">{link.title}</span>
                <span className="block font-geist text-[0.625rem] text-m-muted">{link.sub}</span>
              </span>
              <ExternalLink size={14} className="flex-none text-m-faint" />
            </a>
          ),
        )}
      </div>
    </MSetCard>
  )
}
