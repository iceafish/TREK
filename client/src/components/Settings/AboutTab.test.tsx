import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../tests/helpers/render';
import { resetAllStores } from '../../../tests/helpers/store';
import AboutTab from './AboutTab';

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('AboutTab', () => {
  it('FE-COMP-ABOUT-001: renders without crashing', () => {
    render(<AboutTab appVersion="2.9.10" />);
    expect(document.body).toBeInTheDocument();
  });

  it('FE-COMP-ABOUT-002: displays the version badge', () => {
    render(<AboutTab appVersion="2.9.10" />);
    expect(screen.getByText('v2.9.10')).toBeInTheDocument();
  });

  it('FE-COMP-ABOUT-003: has no funding or community-server links (fork has neither)', () => {
    render(<AboutTab appVersion="2.9.10" />);
    expect(screen.queryByText('Ko-fi')).toBeNull();
    expect(screen.queryByText('Buy Me a Coffee')).toBeNull();
    expect(screen.queryByText('Discord')).toBeNull();
    expect(document.querySelector('a[href*="ko-fi.com"]')).toBeNull();
    expect(document.querySelector('a[href*="buymeacoffee.com"]')).toBeNull();
    expect(document.querySelector('a[href*="discord.gg"]')).toBeNull();
  });

  it('FE-COMP-ABOUT-006: displays bug report link against this fork', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href*="issues/new"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/iceafish/TREK/issues/new?template=bug_report.yml');
  });

  it('FE-COMP-ABOUT-007: displays feature request link against this fork', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href*="issues/new?template=feature_request.yml"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('FE-COMP-ABOUT-008: links docs to the in-app help, not a GitHub wiki', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href="/help"]');
    expect(link).toBeInTheDocument();
    expect(document.querySelector('a[href*="github.com"][href*="/wiki"]')).toBeNull();
  });

  it('FE-COMP-ABOUT-009: external links have rel="noopener noreferrer"', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const links = document.querySelectorAll('a[target="_blank"]');
    expect(links).toHaveLength(2);
    links.forEach((link) => {
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('FE-COMP-ABOUT-010: the in-app help link does not force a new tab', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const helpLink = document.querySelector('a[href="/help"]');
    expect(helpLink).not.toHaveAttribute('target');
  });

  it('FE-COMP-ABOUT-011: version prop change is reflected', () => {
    render(<AboutTab appVersion="1.0.0" />);
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.queryByText('v2.9.10')).toBeNull();
  });

  it('FE-COMP-ABOUT-015: Bug report link hover changes border and box-shadow styles', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href*="issues/new"]') as HTMLAnchorElement;
    fireEvent.mouseEnter(link);
    expect(link.style.borderColor).toBe('rgb(239, 68, 68)');
    expect(link.style.boxShadow).not.toBe('');
    fireEvent.mouseLeave(link);
    expect(link.style.borderColor).toBe('var(--border-primary)');
    expect(link.style.boxShadow).toBe('none');
  });

  it('FE-COMP-ABOUT-016: Feature request link hover changes border and box-shadow styles', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href*="issues/new?template=feature_request.yml"]') as HTMLAnchorElement;
    fireEvent.mouseEnter(link);
    expect(link.style.borderColor).toBe('rgb(245, 158, 11)');
    expect(link.style.boxShadow).not.toBe('');
    fireEvent.mouseLeave(link);
    expect(link.style.borderColor).toBe('var(--border-primary)');
    expect(link.style.boxShadow).toBe('none');
  });

  it('FE-COMP-ABOUT-017: Wiki link hover changes border and box-shadow styles', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href="/help"]') as HTMLAnchorElement;
    fireEvent.mouseEnter(link);
    expect(link.style.borderColor).toBe('rgb(99, 102, 241)');
    expect(link.style.boxShadow).not.toBe('');
    fireEvent.mouseLeave(link);
    expect(link.style.borderColor).toBe('var(--border-primary)');
    expect(link.style.boxShadow).toBe('none');
  });
});
