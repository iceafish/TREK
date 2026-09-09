import { BookOpen, Bug, ExternalLink, Heart, Info, Lightbulb } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n';
import Section from './Section';
import { useAuthStore } from '../../store/authStore';
import {
  FEATURE_REQUEST_URL,
  HELP_HOME_PATH,
  REPO_URL,
  REPORT_BUG_URL,
} from '../../utils/repoLinks';

interface Props {
  appVersion: string;
}

export default function AboutTab({ appVersion }: Props): React.ReactElement {
  const { t } = useTranslation();
  const managed = useAuthStore((s) => s.managed);

  return (
    <Section title={t('settings.about')} icon={Info}>
      <style>{`
        @keyframes heartPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
      <p
        className="text-content-secondary"
        style={{ fontSize: 'calc(13px * var(--fs-scale-body, 1))', lineHeight: 1.6, marginBottom: 6, marginTop: -4 }}
      >
        {/* The stock line calls TREK self-hosted and points at 'your own server'.
            Both are true for the reader who set it up and neither is for a customer
            of a hosted instance, so the mode picks the sentence rather than the
            wording being watered down for everybody. */}
        {t(managed ? 'settings.about.descriptionManaged' : 'settings.about.description')}
      </p>
      <p
        className="text-content-faint"
        style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', lineHeight: 1.6, marginBottom: 16 }}
      >
        {t('settings.about.madeWith')}{' '}
        <Heart
          size={11}
          fill="#991b1b"
          stroke="#991b1b"
          style={{ display: 'inline-block', verticalAlign: '-1px', animation: 'heartPulse 1.5s ease-in-out infinite' }}
        />{' '}
        <span
          className="bg-surface-tertiary text-content-faint"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 99,
            padding: '1px 7px',
            fontSize: 'calc(10px * var(--fs-scale-caption, 1))',
            fontWeight: 600,
            verticalAlign: '1px',
          }}
        >
          v{appVersion}
        </span>
      </p>

      {/* The issue links assume the reader runs this install and can act on it.
          On a centrally administered one they file bugs against an instance they
          do not operate. The version and the source link below stay in both
          modes: AGPL §13 wants the source offered prominently to the people
          using it over a network, and that is not the part being trimmed here.
          (Upstream's funding/Discord cards are gone for good: this fork has no
          funding channels and no community server to send anyone to.) */}
      {!managed && (<>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <a
          href={REPORT_BUG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-surface-card px-5 py-4 no-underline transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#ef4444';
            e.currentTarget.style.boxShadow = '0 0 0 1px #ef444422';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-primary)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div
            className="bg-[#ef444415]"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Bug size={20} className="text-[#ef4444]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-content">{t('settings.about.reportBug')}</div>
            <div className="text-xs text-content-faint">{t('settings.about.reportBugHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0 text-content-faint" />
        </a>
        <a
          href={FEATURE_REQUEST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-surface-card px-5 py-4 no-underline transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#f59e0b';
            e.currentTarget.style.boxShadow = '0 0 0 1px #f59e0b22';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-primary)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div
            className="bg-[#f59e0b15]"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Lightbulb size={20} className="text-[#f59e0b]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-content">{t('settings.about.featureRequest')}</div>
            <div className="text-xs text-content-faint">{t('settings.about.featureRequestHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0 text-content-faint" />
        </a>
        {/* In-app help, not the GitHub wiki: the wiki/ content ships with the
            app and is served at /help, so it matches the running version — the
            GitHub wiki of this fork is not kept in sync. */}
        <Link
          to={HELP_HOME_PATH}
          className="flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-surface-card px-5 py-4 no-underline transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#6366f1';
            e.currentTarget.style.boxShadow = '0 0 0 1px #6366f122';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-primary)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div
            className="bg-[#6366f115]"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <BookOpen size={20} className="text-[#6366f1]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-content">Wiki</div>
            <div className="text-xs text-content-faint">{t('settings.about.wikiHint')}</div>
          </div>
        </Link>
      </div>
      </>)}

      {/* What replaces the grids above. AGPL §13 asks for the source to be
          offered prominently to whoever uses the software over a network, and a
          customer of a hosted instance is exactly that reader. The support and
          bug-report links go; this does not. */}
      {managed && (
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-surface-card px-5 py-4 no-underline"
        >
          <div>
            <div className="text-sm font-semibold text-content">{t('settings.about.sourceTitle')}</div>
            <div className="text-xs text-content-faint">{t('settings.about.sourceHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0 text-content-faint" />
        </a>
      )}
    </Section>
  );
}
