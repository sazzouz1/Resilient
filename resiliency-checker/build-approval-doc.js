const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType,
} = require('docx');

const BLUE = '1F4E79';
const LIGHT = 'DCE6F1';
const GREY = '595959';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, color: level === HeadingLevel.HEADING_1 ? BLUE : '000000', bold: true })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 100 }, ...opts,
    children: [new TextRun({ text, ...opts.run })] });
}
function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 },
    children: [new TextRun(text)] });
}

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
};
function tc(text, { bold = false, header = false, width } = {}) {
  return new TableCell({
    borders: cellBorders,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, fill: BLUE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: bold || header, color: header ? 'FFFFFF' : '000000', size: 19 })] })],
  });
}
function table(headers, rows, widths) {
  const headerRow = new TableRow({ tableHeader: true,
    children: headers.map((hd, i) => tc(hd, { header: true, width: widths && widths[i] })) });
  const bodyRows = rows.map(r => new TableRow({
    children: r.map((c, i) => tc(c, { width: widths && widths[i] })) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}
function spacer() { return new Paragraph({ spacing: { after: 80 }, children: [] }); }

const children = [];

// Title
children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 40 },
  children: [new TextRun({ text: 'Azure Infrastructure & Network Approval Request', bold: true, size: 34, color: BLUE })] }));
children.push(new Paragraph({ spacing: { after: 40 },
  children: [new TextRun({ text: 'ADGE Resiliency Checker — Private Web Application Deployment', size: 24, color: GREY })] }));
children.push(new Paragraph({ spacing: { after: 200 },
  children: [new TextRun({ text: 'Date: 25 August 2026     |     Requestor: ____________________     |     Approver: ____________________', size: 18, color: GREY })] }));

// Purpose
children.push(h('1. Purpose'));
children.push(p('This document requests approval and provisioning support to deploy the ADGE Resiliency Checker — an internal web dashboard over the RelAZ_Assess zone-resiliency assessment output — onto Azure as a private, network-isolated application. The app is a zero-dependency Node.js service. It must be reachable only from the internal ADGOV network, authenticated via Microsoft Entra ID, and restricted to a named security group.'));

// Resources
children.push(h('2. Azure Resources (app / spoke subscription)'));
children.push(p('Provisioned in the application subscription and resource group.'));
children.push(table(
  ['Resource', 'SKU / Configuration', 'Purpose'],
  [
    ['Resource group', '1, in app subscription', 'Container for all app resources'],
    ['App Service Plan', 'Linux, B1 (S1 if deployment slots needed)', 'Compute for the web app'],
    ['Web App (App Service)', 'Node 20 runtime, code deploy (no container)', 'Runs the dashboard'],
    ['Storage account', 'StorageV2, Standard_LRS, TLS 1.2, public access disabled', 'Hosts the CSV assessment data'],
    ['Azure Files share', 'Name: data-root, ~5 GB quota', 'Holds MasterReport.csv files'],
    ['Entra app registration', 'Single-tenant (for Easy Auth)', 'Application authentication'],
  ],
  [26, 40, 34]));
children.push(spacer());

// Networking
children.push(h('3. Networking — Requires Network Team Approval / Provisioning'));
children.push(table(
  ['Item', 'Requirement', 'Notes'],
  [
    ['Virtual network', 'Existing spoke VNet (preferred) or new', 'Confirm VNet name + subscription'],
    ['Integration subnet', 'Dedicated, delegated to Microsoft.Web/serverFarms, empty, >= /27', 'App Service regional VNet integration (outbound)'],
    ['Private-endpoint subnet', '>= /27, PE network policies disabled', 'Hosts the two private endpoints'],
    ['Address space', '~2 x /27 free, non-overlapping', 'Must not clash with existing ranges'],
    ['VNet integration', 'App routed to integration subnet, route-all enabled', 'All app outbound flows through the VNet'],
  ],
  [24, 40, 36]));
children.push(spacer());

// Private endpoints
children.push(h('4. Private Endpoints (2)'));
children.push(table(
  ['Private endpoint', 'Target sub-resource', 'Result'],
  [
    ['Storage private endpoint', 'Storage account -> file', 'App reads CSV data privately over SMB'],
    ['App Service private endpoint', 'Web App -> sites', 'App reachable only from the internal network'],
  ],
  [30, 30, 40]));
children.push(p('After both private endpoints are in place, public inbound to the web app and public access to the storage account are disabled.', { spacing: { before: 100, after: 100 }, run: { italics: true, color: GREY } }));

// Private DNS
children.push(h('5. Private DNS — Platform / Network Team Owned'));
children.push(table(
  ['Zone / Item', 'Needed for', 'Owner'],
  [
    ['privatelink.file.core.windows.net', 'Storage PE name resolution', 'Central hub zone if it exists (do not duplicate)'],
    ['privatelink.azurewebsites.net', 'App PE name resolution', 'Central hub zone if it exists'],
    ['VNet link + record registration', 'Resolve PE FQDNs to private IPs', 'Usually via platform DINE policy'],
    ['On-prem DNS forwarding', 'ADGOV users resolving app FQDN over ExpressRoute/VPN', 'Conditional forwarder -> Azure DNS Private Resolver / hub forwarders'],
  ],
  [30, 34, 36]));
children.push(spacer());

// RBAC
children.push(h('6. RBAC / Permissions to Grant the Deploying Identity'));
children.push(table(
  ['Permission', 'Scope', 'Why'],
  [
    ['Contributor', 'App resource group', 'Create app, plan, storage, private endpoints'],
    ['Network Contributor (or subnets/join/action)', 'The two subnets in the VNet', 'Required for VNet integration + private endpoints'],
    ['Private DNS Zone Contributor (or rely on DINE policy)', 'The privatelink zones', 'Register PE records if not policy-managed'],
    ['App registration / Enterprise App admin', 'Entra tenant', 'Configure Easy Auth and assign viewer group'],
    ['Entra security group', 'e.g. DGE-Resiliency-Viewers', 'Restricts who can sign in to the app'],
  ],
  [34, 30, 36]));
children.push(spacer());

// Policy exceptions
children.push(h('7. Policy / Firewall Exceptions to Clear'));
children.push(bullet('Storage account with key-based Azure Files mount (if org policy blocks shared-key access — App Service BYO storage uses the storage account key).'));
children.push(bullet('Public access temporarily enabled during initial deployment, locked down as the final step — or an in-VNet deployment path (jumpbox / self-hosted agent) provided instead.'));
children.push(bullet('App Service outbound to login.microsoftonline.com for the Easy Auth token flow (normally already permitted).'));
children.push(bullet('Any Azure Policy requiring specific tags, region (UAE North), or private-only enforcement — confirm compliance.'));

// Data flow
children.push(h('8. Data-Flow Summary (Security Review)'));
const flow = [
  'ADGOV user (ExpressRoute / VPN)',
  '   -> Entra sign-in: assigned security group only',
  '   -> App Service private endpoint (privatelink.azurewebsites.net)',
  '   -> Web App (VNet-integrated, no public inbound)',
  '   -> Storage Files private endpoint (privatelink.file.core.windows.net)',
  '   -> CSV data (no public access)',
];
flow.forEach(line => children.push(new Paragraph({ spacing: { after: 20 },
  children: [new TextRun({ text: line, font: 'Consolas', size: 18 })] })));
children.push(p('No component is internet-exposed; data stays on the private network; access is limited to an Entra security group.', { spacing: { before: 100 }, run: { italics: true, color: GREY } }));

// Info requested back
children.push(h('9. Information Requested Back from the Network Team'));
children.push(table(
  ['Item', 'Value to provide'],
  [
    ['VNet name + resource group + subscription', '________________________________'],
    ['Integration subnet name (delegated)', '________________________________'],
    ['Private-endpoint subnet name', '________________________________'],
    ['Private DNS: centrally managed? (Y/N)', '________________________________'],
    ['DINE policy auto-registers PE records? (Y/N)', '________________________________'],
    ['On-prem DNS forwarding in place? (Y/N)', '________________________________'],
    ['Approved region', '________________________________'],
  ],
  [55, 45]));
children.push(spacer());

// Sign-off
children.push(h('10. Approval Sign-off'));
children.push(table(
  ['Role', 'Name', 'Signature / Date'],
  [
    ['Network / Platform team', '', ''],
    ['Security / Compliance', '', ''],
    ['Application owner', '', ''],
  ],
  [34, 33, 33]));

const doc = new Document({
  creator: 'ADGE Resiliency Checker',
  title: 'Azure Infrastructure & Network Approval Request',
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = 'C:\\ADGE Resiliency\\resiliency-checker\\ADGE-Resiliency-Checker-Azure-Approval-Request.docx';
  fs.writeFileSync(out, buf);
  console.log('WROTE ' + out + ' (' + buf.length + ' bytes)');
});
