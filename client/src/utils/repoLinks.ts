/**
 * The GitHub repository this client's deployment belongs to, and the links
 * derived from it. Single source of truth so the About tab, the admin release
 * panel, footers and update dialogs cannot drift onto different repos.
 *
 * This is the fork's own repository — never point these at upstream
 * (liketrek/TREK): its issues, wiki and releases do not describe this build.
 * The server-side counterpart is the TREK_REPO env (server/src/app-config/derive.ts).
 */
export const SOURCE_REPO = 'iceafish/TREK';

export const REPO_URL = `https://github.com/${SOURCE_REPO}`;

export const REPORT_BUG_URL = `${REPO_URL}/issues/new?template=bug_report.yml`;

export const FEATURE_REQUEST_URL = `${REPO_URL}/issues/new?template=feature_request.yml`;

/** In-app help routes — served from the bundled wiki/, so they match the running version. */
export const HELP_HOME_PATH = '/help';
export const HELP_TROUBLESHOOTING_PATH = '/help/Troubleshooting';
export const HELP_UPDATING_PATH = '/help/Updating';
