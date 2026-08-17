import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOFTWARE_DEFINITIONS = [
  {
    software: 'Xero',
    channel: 'virtualfd',
    actions: [
      'Create and Send an Invoice', 'Reconcile Bank Accounts', 'Add a New Bank Account',
      'Set Up Chart of Accounts', 'Import Bank Statements CSV', 'Run a Profit and Loss Report',
      'Create a Repeating Invoice', 'Set Up Sales Tax / VAT Rates', 'Invite a User or Accountant',
      'Track Expenses with Receipts', 'Create a Credit Note', 'Set Up Payment Gateway (Stripe)',
      'Manage Fixed Assets', 'Run Balance Sheet Report', 'Send Invoice Payment Reminders',
      'Void or Edit an Invoice', 'Reconcile Multi-Currency Transactions', 'Set Up Tracking Categories',
      'Export General Ledger', 'Generate 1099 Contractor Reports', 'Apply Prepayments and Overpayments',
      'Create Purchase Orders', 'Archive Inactive Accounts', 'Set Up Direct Debit Bank Feeds',
      'Batch Pay Supplier Bills', 'Customize Invoice Templates / Branding', 'Run Aged Receivables Report',
      'Reconcile PayPal and Stripe Feeds', 'Set Up Bank Rules for Auto-Reconciliation', 'Manage Inventory Items'
    ],
    variations: ['Step by Step', 'in 2 Minutes', 'for Beginners', 'Fast Tutorial', '2026 Updated']
  },
  {
    software: 'Dext',
    channel: 'virtualfd',
    actions: [
      'Submit Receipts via Mobile App', 'Connect Dext to Xero', 'Connect Dext to QuickBooks Online',
      'Set Up Auto-Categorization Rules', 'Extract Line Items from Invoices', 'Set Up Email-in Receipt Forwarding',
      'Split Expenses Across Multiple Accounts', 'Approve and Publish Supplier Costs', 'Manage Multi-Currency Receipts',
      'Create Supplier Approval Rules', 'Export Receipts to PDF / CSV', 'Fix Unmatched Transactions',
      'Set Up User Permissions', 'Reconcile Bank Match Warnings', 'Archive and Delete Old Receipts'
    ],
    variations: ['Quick Guide', 'in Under 3 Mins', 'Workflow Guide', 'Best Practice']
  },
  {
    software: 'Pipedrive',
    channel: 'virtualfd',
    actions: [
      'Create and Customize Deal Pipelines', 'Sync Gmail / Outlook Email Inbox', 'Set Up Automated Follow-Up Activity',
      'Import Contacts from CSV / Excel', 'Create Custom Fields for Deals', 'Set Up Web Forms for Lead Capture',
      'Use LeadBooster Chatbot', 'Filter and Segment Deals by Value', 'Track Lost Deal Reasons',
      'Set Up Workflow Automations', 'Create Email Templates with Merge Tags', 'Manage Sales Goals and Quotas',
      'Export Contacts and Deals to CSV', 'Schedule Activities and Meetings', 'Customize Dashboard Insights'
    ],
    variations: ['for Beginners', 'in 2 Minutes', 'Masterclass', 'Sales Guide']
  },
  {
    software: 'Deel',
    channel: 'virtualfd',
    actions: [
      'Create an Independent Contractor Contract', 'Withdraw Funds to Bank Account / Crypto', 'Submit Expenses for Reimbursement',
      'Upload Tax Compliance Documents (W-8BEN / W-9)', 'Sign and Review EOR Employment Contract', 'Set Up Automatic Invoicing',
      'Add a Payment Method (Wise, PayPal, Wire)', 'Request an Advance on Unpaid Invoices', 'Generate Invoice PDF Receipts',
      'Manage Time Off and Holidays', 'Invite a Contractor to Organization', 'Set Up Deel Card Virtual Debit'
    ],
    variations: ['Step by Step', 'Quick Walkthrough', 'for Contractors', 'for Employers']
  },
  {
    software: 'Remote.com',
    channel: 'virtualfd',
    actions: [
      'Onboard an International Employee', 'Create a Contractor Agreement', 'Approve Contractor Invoices',
      'Set Up Local Currency Payouts', 'Manage Global Benefits and Health Insurance', 'Review Employee Time Off Requests',
      'Upload Required Identity Verification Docs', 'Configure Company Billing Settings', 'Download End-of-Year Tax Summaries'
    ],
    variations: ['in 2 Minutes', 'Complete Guide', 'Fast Setup']
  },
  {
    software: 'Rippling',
    channel: 'virtualfd',
    actions: [
      'Run US / Global Payroll', 'Provision Laptop and Device Management', 'Assign Single Sign-On (SSO) Apps',
      'Onboard a New Hire in 90 Seconds', 'Configure Time Off and PTO Policies', 'Set Up Department Hierarchy',
      'Offboard an Employee and Revoke Access', 'Manage Health Insurance Benefits', 'Create Custom Employee Reports'
    ],
    variations: ['for HR Teams', 'Quick Tutorial', 'Fast Walkthrough']
  },
  {
    software: 'TradingView',
    channel: 'skool',
    actions: [
      'Set Up Pine Script Custom Alerts', 'Use Fibonacci Retracement Tool', 'Add Volume Profile Indicator',
      'Save and Share Multi-Chart Layouts', 'Set Up Paper Trading Simulator', 'Create Custom Watchlists with Colors',
      'Configure Buy and Sell Indicator Strategy', 'Use Bar Replay Mode for Backtesting', 'Customize Candlestick Chart Colors',
      'Set Up Price Breakout Alerts via Webhook', 'Add Moving Average Convergence Divergence (MACD)', 'Draw Trendlines and Support/Resistance'
    ],
    variations: ['Pro Tips', 'in 2 Minutes', 'for Beginners', 'Secret Tricks']
  },
  {
    software: 'Notion',
    channel: 'skool',
    actions: [
      'Create Formula 2.0 Properties', 'Set Up Database Relations and Rollups', 'Create Automated Button Actions',
      'Group and Sub-group Board Views', 'Build a Recurring Tasks Template', 'Embed Google Drive and Figma Files',
      'Create Synced Blocks Across Pages', 'Export Page to Clean PDF / Markdown', 'Set Up Multi-Select Status Workflows',
      'Use Notion AI to Summarize Notes', 'Lock Pages and Database Views', 'Create Nested Toggle Callout Lists',
      'Build a Habit Tracker Database', 'Create a Client Portal Dashboard', 'Share Public Web Page with Custom Domain'
    ],
    variations: ['in 2 Mins', 'Step by Step', 'for Productivity', '2026 Layout']
  },
  {
    software: 'ClickUp',
    channel: 'skool',
    actions: [
      'Create Custom Fields for Tasks', 'Build Sprint Folders and Points', 'Set Up Automations for Status Changes',
      'Create a Gantt Chart Timeline View', 'Embed Whiteboards in Tasks', 'Set Up Time Tracking and Estimates',
      'Build a Custom Dashboard with Widgets', 'Create Task Templates with Subtasks', 'Integrate ClickUp with Slack and GitHub',
      'Manage Workspace Permissions and Guests', 'Set Up Mind Map View from Tasks', 'Use ClickUp Brain AI for Docs'
    ],
    variations: ['Workflow Setup', 'in Under 3 Mins', 'for Beginners']
  },
  {
    software: 'Monday.com',
    channel: 'skool',
    actions: [
      'Create Custom Board Automations', 'Use Formula Columns for Calculations', 'Set Up Workload Management View',
      'Create a Shareable Form for Intake', 'Connect Monday with Gmail and Slack', 'Color Code Status Dropdown Columns',
      'Build a Master Portfolio Dashboard', 'Import Excel Spreadsheet into Board', 'Set Up Dependencies Between Items'
    ],
    variations: ['Quick Tutorial', 'in 2 Minutes', 'Team Guide']
  },
  {
    software: 'Zapier',
    channel: 'blueprint',
    actions: [
      'Create a Multi-Step Zap Workflow', 'Use Webhooks by Zapier (POST/GET)', 'Format Text and Dates with Formatter',
      'Set Up Paths for Conditional Branching', 'Create a Schedule by Zapier Cron Trigger', 'Handle Errors with Zapier Fallback Rules',
      'Transfer Bulk Data Between Apps', 'Connect OpenAI API to Google Sheets', 'Parse Incoming Email Data with Email Parser',
      'Use Code by Zapier (Python / JavaScript)', 'Filter Data with Logical Operators', 'Create Custom Delay / Sleep Action'
    ],
    variations: ['Full Walkthrough', 'in 3 Minutes', 'No-Code Guide']
  },
  {
    software: 'Make',
    channel: 'blueprint',
    actions: [
      'Use Iterator and Array Aggregator Modules', 'Parse and Create Custom JSON Payloads', 'Set Up Router with Filter Conditions',
      'Connect Webhook to Telegram / Slack', 'Use Data Stores for Persistent State', 'Handle API Errors with Resume and Rollback',
      'Automate Google Sheets Row Appends', 'Use Tools Module for Math and Strings', 'Schedule Scenarios with Advanced Cron',
      'Connect Webflow CMS to Airtable', 'Use HTTP Make an OAuth Request', 'Process XML and CSV Files'
    ],
    variations: ['Visual Automation', 'in 2 Mins', 'Integromat Tutorial']
  },
  {
    software: 'HubSpot',
    channel: 'virtualfd',
    actions: [
      'Create Custom Contact Properties', 'Build an Automated Email Sequence', 'Set Up Deal Pipeline Stages',
      'Create a Free Meeting Scheduling Link', 'Embed Lead Capture Forms on Webflow', 'Set Up Lead Scoring Rules',
      'Segment Contacts with Active Lists', 'Create Custom Lifecycle Stages', 'Track Email Opens and Clicks in CRM'
    ],
    variations: ['for Beginners', 'in 2 Minutes', 'CRM Mastery']
  },
  {
    software: 'Airtable',
    channel: 'blueprint',
    actions: [
      'Link Records Across Multiple Tables', 'Set Up Rollup and Lookup Fields', 'Build a Custom App with Interface Designer',
      'Create Automations with Scripting Extension', 'Design a Public Survey Form View', 'Set Up Kanban and Gallery Views',
      'Sync Data Between Multiple Bases', 'Calculate Formulas with IF and Date Functions', 'Integrate Airtable with Softr / Noloco'
    ],
    variations: ['Database Tutorial', 'in 3 Minutes', 'No-Code Guide']
  },
  {
    software: 'Webflow',
    channel: 'blueprint',
    actions: [
      'Create Dynamic CMS Collections', 'Master Flexbox and Grid Layouts', 'Set Up Custom Domain and SSL',
      'Create Hover and Scroll Animation Interactions', 'Make a Sticky Navbar with Blur Effect', 'Embed Lottie JSON Animations',
      'Configure SEO Meta Tags and OpenGraph', 'Build a Multi-Step Contact Form', 'Export Clean Code for Hosting'
    ],
    variations: ['Web Design', 'in 2 Minutes', 'for Beginners']
  },
  {
    software: 'Framer',
    channel: 'blueprint',
    actions: [
      'Create Interactive Components with Variants', 'Set Up Scroll Transform Effects', 'Upload Custom Web Fonts (WOFF2)',
      'Design Responsive Desktop, Tablet, Mobile Breakpoints', 'Build a CMS Blog with Markdown Support', 'Embed 3D Spline Canvas',
      'Set Up Custom Form Submission Webhooks', 'Add Smooth Page Transition Animations', 'Publish Site with Custom Subdomain'
    ],
    variations: ['in 2 Minutes', 'Design Tutorial', 'Framer 2026']
  },
  {
    software: 'Canva',
    channel: 'skool',
    actions: [
      'Use Magic Eraser to Remove Objects', 'Set Up Brand Kit Fonts and Color Palette', 'Curve Text on Badges and Logos',
      'Export High-Res Transparent PNG', 'Add Video Transitions and Audio Sync', 'Bulk Create 100 Graphics from CSV Spreadsheet',
      'Generate Realistic Product Mockups', 'Create Animated YouTube End Screens', 'Remove Background from Product Photos'
    ],
    variations: ['Secret Hacks', 'in 2 Mins', 'for Beginners', 'Design Fast']
  },
  {
    software: 'Figma',
    channel: 'blueprint',
    actions: [
      'Master Auto Layout Hug, Fill, and Fixed Width', 'Create Component Sets with Boolean Properties', 'Build Clickable Interactive Prototypes',
      'Create Color and Typography Design Tokens', 'Export Vector SVG and 2x PNG Assets', 'Use Vector Pen Tool for Custom Icons',
      'Set Up Smart Animate Between Frames', 'Use FigJam for Sprint Planning and Sticky Notes', 'Organize Pages and Component Libraries'
    ],
    variations: ['UI/UX Guide', 'in 3 Minutes', 'Pro Tips']
  },
  {
    software: 'Miro',
    channel: 'skool',
    actions: [
      'Create a Kanban Sprint Board', 'Build a Visual Mind Map with Smart Nodes', 'Run an Anonymous Voting Session',
      'Use Built-in Timer and Music for Workshops', 'Convert Handwritten Notes into Sticky Notes', 'Export High-Resolution Vector PDF',
      'Embed Live Figma and Jira Widgets', 'Lock Background Elements to Prevent Editing', 'Set Up Presentation Mode Slides'
    ],
    variations: ['Collaboration Guide', 'in 2 Minutes', 'Fast Tutorial']
  },
  {
    software: 'Loom',
    channel: 'skool',
    actions: [
      'Record Screen with Circular Webcam Bubble', 'Trim Video and Remove Filler Words (Ums/Uhs)', 'Add Clickable Call-to-Action (CTA) Button',
      'Set Video Password and Privacy Access', 'Use Live Drawing and Highlighter Tool', 'Search and Edit Video Transcript',
      'Embed Loom Video into Notion / Gmail', 'Download MP4 File from Cloud', 'Customize Video Thumbnail and Title'
    ],
    variations: ['in 2 Minutes', 'Quick Guide', 'Productivity Tip']
  },
  {
    software: 'Slack',
    channel: 'skool',
    actions: [
      'Create Custom Workspace Emoji', 'Build a No-Code Workflow Form in Channels', 'Create and Share a Live Canvas Document',
      'Start a Huddle with Screen Sharing and Notes', 'Schedule Messages to Send Later', 'Set Up Keyword Notification Alerts',
      'Create User Groups (@team mentions)', 'Connect Google Calendar for Status Sync', 'Pin and Bookmark Important Channel Links'
    ],
    variations: ['Workspace Hacks', 'in 2 Minutes', 'for Teams']
  },
  {
    software: 'Zoom',
    channel: 'skool',
    actions: [
      'Create and Manage Breakout Rooms', 'Set Up Custom Virtual Background Blur', 'Enable Cloud Recording with Transcript',
      'Customize Waiting Room Message and Logo', 'Assign Co-Hosts and Alternative Hosts', 'Sync Zoom with Google Calendar / Outlook',
      'Share Computer Audio During Video Playback', 'Enable End-to-End Encryption (E2EE)', 'Set Up Registration Form for Webinars'
    ],
    variations: ['in 2 Minutes', 'Quick Setup', 'Meeting Guide']
  },
  {
    software: 'Calendly',
    channel: 'skool',
    actions: [
      'Create One-on-One and Group Event Types', 'Add Buffer Time Before and After Meetings', 'Collect Payments via Stripe / PayPal',
      'Add Custom Intake Questions and Checkboxes', 'Sync Multiple Google / Outlook Calendars', 'Set Up Round Robin Team Scheduling',
      'Embed Calendly Inline Widget on Website', 'Send Automated SMS and Email Reminders', 'Set Minimum Scheduling Notice and Limits'
    ],
    variations: ['in 2 Mins', 'Step by Step', 'Booking Setup']
  },
  {
    software: 'Typeform',
    channel: 'blueprint',
    actions: [
      'Set Up Logic Jump Conditional Branching', 'Use Hidden Fields to Track Referral Sources', 'Connect Stripe for Payment Form Checkouts',
      'Customize Thank You Screen with Redirect URLs', 'Send Email Alerts on Form Submission', 'Embed Typeform Popup on Webflow',
      'Export Responses to Google Sheets Live', 'Add File Upload Question Field', 'Design Custom Background and Fonts'
    ],
    variations: ['Survey Design', 'in 3 Minutes', 'No-Code Guide']
  },
  {
    software: 'n8n',
    channel: 'blueprint',
    actions: [
      'Deploy n8n with Docker Compose on VPS', 'Set Up Webhook Trigger and Response Nodes', 'Connect OpenAI / Groq LLM Node to Workflows',
      'Schedule Automated Tasks with Cron Node', 'Execute Custom JavaScript in Code Node', 'Query PostgreSQL / MySQL Databases',
      'Handle Workflow Errors with Error Trigger Node', 'Automate Telegram Bot Messages', 'Scrape Web Pages with HTTP Request Node'
    ],
    variations: ['Self-Hosted Guide', 'in 3 Minutes', 'Open Source Tutorial']
  },
  {
    software: 'Hotjar',
    channel: 'blueprint',
    actions: [
      'Install Hotjar Tracking Code via GTM', 'Filter Session Recordings by Rage Clicks', 'Create an On-Page Feedback Widget',
      'Set Up User Exit-Intent Survey', 'Analyze Conversion Funnel Drop-offs', 'Configure GDPR IP Masking and Privacy'
    ],
    variations: ['CRO Guide', 'in 2 Minutes', 'Website Analytics']
  },
  {
    software: 'Looker Studio',
    channel: 'virtualfd',
    actions: [
      'Connect Google Analytics 4 (GA4) Data Source', 'Create Calculated Metric Fields', 'Add Date Range and Dimension Filter Controls',
      'Build a Executive Scorecard KPI Dashboard', 'Blend Data Sources from GA4 and Google Ads', 'Schedule Automated PDF Email Reports',
      'Customize Charts with Conditional Formatting', 'Embed Looker Dashboard in Notion / Intranet'
    ],
    variations: ['Dashboard Tutorial', 'in 3 Minutes', 'Data Guide']
  },
  {
    software: 'Semrush',
    channel: 'blueprint',
    actions: [
      'Find Low-Competition Keywords with Magic Tool', 'Analyze Competitor Traffic with Domain Overview', 'Fix Broken Links in Site Audit Crawl',
      'Set Up Daily Position Tracking for Keywords', 'Run Backlink Gap Analysis on Rivals', 'Use On-Page SEO Checker for Actionable Tips'
    ],
    variations: ['SEO Mastery', 'in 2 Minutes', 'Fast Hacks']
  },
  {
    software: 'Klaviyo',
    channel: 'virtualfd',
    actions: [
      'Build an Automated Abandoned Cart Flow', 'Create a 3-Part Welcome Email Series', 'Segment Customers by Purchase History',
      'Set Up SMS Marketing Campaigns', 'Generate Dynamic Shopify Discount Codes', 'Design an Exit-Intent Pop-up Signup Form',
      'A/B Test Email Subject Lines for Open Rates', 'Clean Email List to Improve Deliverability'
    ],
    variations: ['Ecommerce Guide', 'in 3 Minutes', 'Email Marketing']
  },
  {
    software: 'Brevo',
    channel: 'virtualfd',
    actions: [
      'Set Up Transactional SMTP Email Relay', 'Create and Send Bulk SMS Campaigns', 'Build Marketing Automation Drip Sequences',
      'Segment Contact Lists with Custom Attributes', 'Create WhatsApp Business Marketing Campaigns', 'Design Custom Unsubscribe and Preference Pages'
    ],
    variations: ['Sendinblue Guide', 'in 2 Minutes', 'Email Setup']
  },
  {
    software: 'DocuSign',
    channel: 'virtualfd',
    actions: [
      'Place Signature and Date Fields on PDF', 'Set Signing Order for Multiple Recipients', 'Create Reusable Document Templates',
      'Enable SMS Access Code Authentication', 'Generate PowerForms Link for Public Signing', 'Set Document Expiration and Auto-Reminders'
    ],
    variations: ['Legal Guide', 'in 2 Minutes', 'E-Signature Setup']
  },
  {
    software: 'PandaDoc',
    channel: 'virtualfd',
    actions: [
      'Build a Client Sales Proposal Template', 'Set Up Interactive Pricing Tables with Taxes', 'Add Signature and Initials Fields',
      'Track Document Views and Time-per-Page Analytics', 'Use Custom Tokens / Variables to Auto-Fill Data', 'Integrate PandaDoc with HubSpot CRM'
    ],
    variations: ['Sales Guide', 'in 2 Minutes', 'Proposal Tutorial']
  },
  {
    software: 'Gusto',
    channel: 'virtualfd',
    actions: [
      'Onboard a New W-2 Employee', 'Add an Independent 1099 Contractor', 'Run Off-Cycle Payroll or Bonus Payout',
      'Set Up Direct Deposit Bank Details', 'Download End-of-Year W-2 and 1099 Forms', 'Configure Paid Time Off (PTO) Policies'
    ],
    variations: ['Payroll Setup', 'in 2 Minutes', 'HR Guide']
  },
  {
    software: 'BambooHR',
    channel: 'virtualfd',
    actions: [
      'Create and Manage Employee Directory Profiles', 'Approve Employee Time Off Requests', 'Manage Applicant Tracking System (ATS) Pipeline',
      'Assign Onboarding Tasks Checklist to New Hires', 'Build Custom HR Reports and Org Charts', 'Launch Performance Review Feedback Cycles'
    ],
    variations: ['HR Management', 'in 2 Minutes', 'Team Guide']
  },
  {
    software: 'Zendesk',
    channel: 'virtualfd',
    actions: [
      'Create Automated Ticket Triggers and Routing', 'Build Macro Responses for Fast Ticket Resolution', 'Set Up Service Level Agreement (SLA) Policies',
      'Publish Knowledge Base Articles in Help Center', 'Map Organizations and Customer Domains', 'Enable CSAT Customer Satisfaction Surveys'
    ],
    variations: ['Support Guide', 'in 2 Minutes', 'Helpdesk Setup']
  },
  {
    software: 'Intercom',
    channel: 'blueprint',
    actions: [
      'Build Custom Bot Resolution Paths', 'Customize Messenger Widget Brand Colors', 'Create Product Tour Onboarding Series',
      'Send Targeted Outbound Banner Messages', 'Organize Help Center Article Collections', 'Set Up Shared Inbox Team Assignment Rules'
    ],
    variations: ['Customer Success', 'in 2 Minutes', 'Chatbot Guide']
  },
  {
    software: 'Webex',
    channel: 'skool',
    actions: [
      'Configure Meeting Lobby and Security PIN', 'Set Up Custom Virtual Background Blur', 'Record Meetings to Cloud with Transcripts',
      'Optimize Screen Share for Motion Video with Audio', 'Create and Assign Breakout Sessions', 'Install Webex Plugin for Microsoft Outlook'
    ],
    variations: ['Meeting Tutorial', 'in 2 Minutes', 'Remote Work']
  }
];

const volumes = [185000, 142000, 110000, 95000, 78000, 64000, 52000, 48000, 39000, 27000, 18500, 14200, 9800];
const allItems = [];
let idCounter = 1;

for (const def of SOFTWARE_DEFINITIONS) {
  for (const action of def.actions) {
    for (const v of def.variations) {
      const keyword = `How to ${action} in ${def.software} (${v})`;
      const vol = volumes[idCounter % volumes.length];
      allItems.push({
        id: `kw_gen_${idCounter}`,
        keyword,
        software: def.software,
        volume: vol,
        competition: vol > 50000 ? 'Medium' : 'Low',
        screenVerdict: 'APPROVE',
        contentType: 'HOW_TO',
        targetChannelId: def.channel,
        status: 'NEW',
        dateAdded: '2026-08-17',
        estMinutes: Math.floor(Math.random() * 2) + 2
      });
      idCounter++;
    }
  }
}

// Generate up to 2150 keywords
while (allItems.length < 2150) {
  const def = SOFTWARE_DEFINITIONS[allItems.length % SOFTWARE_DEFINITIONS.length];
  const act = def.actions[allItems.length % def.actions.length];
  const keyword = `How to Quickly ${act} in ${def.software} 2026`;
  allItems.push({
    id: `kw_gen_${idCounter}`,
    keyword,
    software: def.software,
    volume: 34000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: def.channel,
    status: 'NEW',
    dateAdded: '2026-08-17',
    estMinutes: 2
  });
  idCounter++;
}

const outPath = path.join(__dirname, '../src/data/keywords2000.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(allItems, null, 2));

console.log(`✅ Successfully generated ${allItems.length} keywords across 37 software tools into ${outPath}`);
