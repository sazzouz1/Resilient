RAISEiliency tool scans all the Azure resource providers listed under Azure services that support availability zones | Microsoft Learn and consolidates resiliency related configuration in common fields which can be visualized and analyzed much quicker. Tool extracts information about:

· Availability set placement

· AZ to physical zone mapping across subscriptions

· AZ redundancy

· AZ pinning

· Same Zone/Zonal High Availability for certain PaaS services

· Capacity unit distribution for zones

· Storage resiliency configuration

· Backup resiliency configuration


Requirements:

· User with reader permission on all subscriptions

· PowerShell console with Az.ResourceGraph module. Script runs graph queries to extract data from subscription. If you don’t have Az.ResourceGraph module installed Search-AzGraph command will fail and no data will be collected.

If you don’t have the module just reinstall Azure PowerShell using:

Install-Module -Name Az -Repository PSGallery -Force


High level steps :

a. Run the WARA Collector script as described in GitHub documentation. Run the script against all customer subscriptions. Depending on the size of the environment this might take a while. (Collector Script | Azure Proactive Resiliency Library v2)

Once finishes script generates a Json file like WARA_File_2024-09-19-…...Json

Customer needs to share you this Json file.

b. Run the ReliabilityExportv…ps1 (details can be found in this guide)

Script creates a csv file for each resource provider and stores it under folder defined in script parameter.

c. Ask customer to zip and share all raw export files (report_<AzureProvider>.csv) and Wara_File….Json d. On your own laptop , Run Wara Analyzer Script | Azure Proactive Resiliency Library v2 script to generate WARA Excel report

e. Rename WARA Excel report to WARA Action Plan.xlsx . PowerBI templates loads this file.

f. On your own laptop, run ReliabilityAnalyzerv..ps1 report to generate MasterReport.csv

g. Open PowerBI Template file (.pbit) and and load all required datasets from the export folder.

Resources :


ReliabilityExport PowerShell Script


This script connects to Azure, retrieves the subscription list the user has access to, and iterates through all subscriptions to export Azure resource details. It automatically expands all tags and properties of Azure Resource Manager (ARM) resources.

Script Parameters

· exportfolder : Folder where raw export files located

· tenantscope(optional): With tenantscope script can be scoped to a specific tenant. If not provided script will get all the subscriptions user has access to and export all of them to exportfolder.






Once the script completes, it generates a CSV export for each resource provider with tags and provider-specific properties. These exports contain raw, unformatted data, which may not be suitable for manual reading or analysis.


Azure RBAC Requirement

Only reader permission on all scanned subscriptions is needed to run the script.

ReliabilityAnalyzer PowerShell Script


This script reads raw CSV exports and extracts useful properties related to resiliency configuration for the master report. Extracted properties are correlated within the scripts, such as:

a. VM to Disk to Storage Type

b. Az Resource- backup config – backup storage type

c. VM to NIC to PublicIP

d. Load BAnacer to Frontend Config to Public Ip

e. AzFw to PuplicIP

f. APP GW to Public IP

g. APP Svc Plan to Websites

h. Backup info for Azure Resources

i. ASR Replication details for VMs

Script Parameters

· exportfolder : Folder where raw CSV files from the exporter script are stored.

· custtags:Accepts array of values as customer tags to be included in the dashboard.

It is very important to get list of tags from customer that identifies the workload ( App name , project name , environment etc. If no tag is defined script automatically uses and empty array for $custtags.



These tags are appended to certain default fields defined in Analyzer script and included in the MasterReport.csv . Analyzer script only gets certain fields and tags to produce more meaningful output .

For each Azure resource, analyzer script script populates ResiliencyConfig, ResiliencyDetails fields and adds backup/ASR related information, backup storage resiliency config and public IP details where applicable.

Sample View:




As mentioned before tags which identifies the workloads are used in PowerBI dashboard as filters; For example getting all resources for Active Directory application tag in Production environment



Analyzer script generates the following files :



AzureRetirements lists any resource that is already retired or will be retired with detailed info on date and announcement

MasterReport is the main output , report combines report which feeds into PowerBI for analyzing Azure resources using tags or resource groups or by subscriptions

Asr_backup file is the inventory for all backup enabled resources and ASR enabled resources with their status last backup date etc. This can be used for backup summary in PowerBI

PipReport has all public IP address inventory including the resources they are attached to zone redundancy etc. This is linked to master report for created extended views

MasterReport.resourceid==Pipreport.usingresourceid


AzureRetirment.Json file has the definition for retiring services. Export script export azure resources an retirement ids and analyzer corelates these ids using json file to generate human readable AzureRetirments.csv


ReliabilityAssement PowerBI Template


Resources folder includes a template which can be used to present and handover to the customer. Open the ReliabilityAsesstement.pbit file with PowerBI Desktop.


Fill in the export folder where MasterReport and WARA Action Plan.xlsx is located and click load.

You will need to :

· Fix broken references for tags used in dashboard

· Filter out nonprod related subscriptions

· Filter out nonprod related resource groups ( Sandbox,ddev, qa,uat,nonprod etc)
