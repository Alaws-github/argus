// Business tools (v1.7.1): the tools a client's governance, risk and assurance
// work already happens in. A workflow step names the tool it happens in, and,
// where ARGUS can read from that tool, links to a read-only connector that
// pulls evidence or status from it. ARGUS never writes to these tools.
//
// `read` says how a connector reads the tool: the sign-in it needs, an example
// address (an API that answers GET) and what to set up on the client's side.
// Tools with read: null are mapped in workflows but not read by ARGUS (they
// either have no read API that fits, or reading needs a sign-in flow that
// writes, such as a POST sign-in).
export type ToolUse = 'documents' | 'approvals' | 'tickets' | 'notify' | 'spreadsheet' | 'dashboard' | 'sign' | 'tasks';
export type ToolAuth = 'azure_ad' | 'google_sa' | 'basic' | 'bearer' | 'header';
export interface ToolRead { auth: ToolAuth; scope?: string; url: string; help: string; headerName?: string }
export interface BusinessTool { id: string; name: string; group: string; mono: string; color: string; uses: ToolUse[]; read: ToolRead | null }

const GRAPH = 'https://graph.microsoft.com/.default';
const M365_HELP = "Register an app in the client's Microsoft Entra admin centre with read-only application permissions (for example Sites.Read.All, Files.Read.All), have an admin grant consent, then enter the tenant ID, client ID and a client secret.";
const GOOGLE_HELP = "Create a service account in the client's Google Cloud project, share the drive, folder or sheet with its email address (Viewer), and paste its JSON key.";

export const BUSINESS_TOOLS: BusinessTool[] = [
  // Microsoft 365
  { id: 'sharepoint', name: 'SharePoint', group: 'Microsoft 365', mono: 'SP', color: '#0f7b8a', uses: ['documents', 'approvals'],
    read: { auth: 'azure_ad', scope: GRAPH, url: 'https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/Policies/AI-policy.docx:/content', help: M365_HELP } },
  { id: 'onedrive', name: 'OneDrive', group: 'Microsoft 365', mono: 'OD', color: '#1f6fd1', uses: ['documents'],
    read: { auth: 'azure_ad', scope: GRAPH, url: 'https://graph.microsoft.com/v1.0/users/{user-id}/drive/root:/Evidence/export.xlsx:/content', help: M365_HELP } },
  { id: 'teams', name: 'Teams', group: 'Microsoft 365', mono: 'T', color: '#5b5fc7', uses: ['notify', 'approvals'],
    read: { auth: 'azure_ad', scope: GRAPH, url: 'https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages', help: `${M365_HELP} Reading channel messages needs ChannelMessage.Read.All.` } },
  { id: 'outlook', name: 'Outlook', group: 'Microsoft 365', mono: 'O', color: '#0a64ad', uses: ['notify', 'approvals'],
    read: { auth: 'azure_ad', scope: GRAPH, url: "https://graph.microsoft.com/v1.0/users/{mailbox}/messages?$filter=contains(subject,'AI approval')", help: `${M365_HELP} Reading a mailbox needs Mail.Read; limit it to one shared mailbox with an application access policy.` } },
  { id: 'excel', name: 'Excel', group: 'Microsoft 365', mono: 'X', color: '#1d7a45', uses: ['spreadsheet'],
    read: { auth: 'azure_ad', scope: GRAPH, url: 'https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/Risk/AI-risk-register.xlsx:/content', help: M365_HELP } },
  { id: 'planner', name: 'Planner', group: 'Microsoft 365', mono: 'PL', color: '#317a3c', uses: ['tasks'],
    read: { auth: 'azure_ad', scope: GRAPH, url: 'https://graph.microsoft.com/v1.0/planner/plans/{plan-id}/tasks', help: `${M365_HELP} Needs Tasks.Read.All.` } },
  { id: 'power_automate', name: 'Power Automate', group: 'Microsoft 365', mono: 'PA', color: '#0b66e4', uses: ['approvals', 'notify'], read: null },
  { id: 'power_bi', name: 'Power BI', group: 'Microsoft 365', mono: 'BI', color: '#c79b0a', uses: ['dashboard'],
    read: { auth: 'azure_ad', scope: 'https://analysis.windows.net/powerbi/api/.default', url: 'https://api.powerbi.com/v1.0/myorg/groups/{workspace-id}/reports', help: `${M365_HELP} Allow the app in the Power BI admin portal (service principals can use Power BI APIs).` } },
  // Service and work management
  { id: 'servicenow', name: 'ServiceNow', group: 'Service and work management', mono: 'SN', color: '#2e7d5b', uses: ['tickets', 'approvals', 'tasks'],
    read: { auth: 'basic', url: 'https://{instance}.service-now.com/api/now/table/change_request?sysparm_query=short_descriptionLIKEAI&sysparm_limit=50', help: 'Create an integration user with a read-only role for the tables you need (for example change_request, sn_risk_risk), and enter user:password.' } },
  { id: 'jira', name: 'Jira', group: 'Service and work management', mono: 'J', color: '#1868db', uses: ['tickets', 'tasks', 'approvals'],
    read: { auth: 'basic', url: 'https://{site}.atlassian.net/rest/api/3/search?jql=project%3DGRC%20AND%20labels%3Dai', help: 'Use an account that can browse the project, create an API token for it, and enter email:token.' } },
  { id: 'confluence', name: 'Confluence', group: 'Service and work management', mono: 'C', color: '#1d5fd1', uses: ['documents'],
    read: { auth: 'basic', url: 'https://{site}.atlassian.net/wiki/api/v2/pages/{page-id}?body-format=storage', help: 'Use an account that can view the space, create an API token for it, and enter email:token.' } },
  // Google Workspace and Slack
  { id: 'google_drive', name: 'Google Drive', group: 'Google Workspace and Slack', mono: 'GD', color: '#1a73e8', uses: ['documents'],
    read: { auth: 'google_sa', scope: 'https://www.googleapis.com/auth/drive.readonly', url: 'https://www.googleapis.com/drive/v3/files/{file-id}?alt=media', help: GOOGLE_HELP } },
  { id: 'google_sheets', name: 'Google Sheets', group: 'Google Workspace and Slack', mono: 'GS', color: '#188038', uses: ['spreadsheet'],
    read: { auth: 'google_sa', scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', url: 'https://sheets.googleapis.com/v4/spreadsheets/{sheet-id}/values/Risks!A1:Z500', help: GOOGLE_HELP } },
  { id: 'gmail', name: 'Gmail', group: 'Google Workspace and Slack', mono: 'GM', color: '#c5221f', uses: ['notify', 'approvals'], read: null },
  { id: 'slack', name: 'Slack', group: 'Google Workspace and Slack', mono: 'SL', color: '#611f69', uses: ['notify', 'approvals'],
    read: { auth: 'bearer', url: 'https://slack.com/api/conversations.history?channel={channel-id}&limit=200', help: 'Create a Slack app with the channels:history read scope, add it to the channel, and enter its bot token.' } },
  // GRC, data and signing
  { id: 'grc_platform', name: 'GRC platform', group: 'GRC, data and signing', mono: 'GR', color: '#7c5cf0', uses: ['tickets', 'approvals', 'documents'],
    read: { auth: 'bearer', url: 'https://grc.client.example/api/v1/risks?export=csv', help: "Most GRC platforms have a read-only REST or report export. Ask the platform owner for a read-only API token and the export address." } },
  { id: 'tableau', name: 'Tableau', group: 'GRC, data and signing', mono: 'TB', color: '#e8762d', uses: ['dashboard'], read: null },
  { id: 'docusign', name: 'DocuSign', group: 'GRC, data and signing', mono: 'DS', color: '#4c00ff', uses: ['sign', 'approvals'],
    read: { auth: 'bearer', url: 'https://{account}.docusign.net/restapi/v2.1/accounts/{account-id}/envelopes/{envelope-id}', help: 'An access token from a DocuSign integration key with the signature scope. Tokens expire; replace it when pulls start failing.' } },
  { id: 'other', name: 'Other tool', group: 'Other', mono: '…', color: '#6b7280', uses: ['documents', 'approvals', 'tickets', 'notify'],
    read: { auth: 'bearer', url: 'https://reports.client.example/export.csv', help: 'Any report or export link that answers a plain read request, with a read-only token.' } },
];
export const TOOL_GROUPS = [...new Set(BUSINESS_TOOLS.map((t) => t.group))];
export const toolById = (id?: string | null) => BUSINESS_TOOLS.find((t) => t.id === id) ?? null;
export const TOOL_USE_LABELS: Record<ToolUse, string> = {
  documents: 'documents', approvals: 'approvals', tickets: 'tickets', notify: 'messages', spreadsheet: 'spreadsheets', dashboard: 'dashboards', sign: 'signatures', tasks: 'tasks',
};
