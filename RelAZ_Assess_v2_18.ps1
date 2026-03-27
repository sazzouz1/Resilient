<#
This tool and associated scripts are provided for informational and assessment purposes only and do not represent an official Microsoft product or supported solution.

All outputs are generated based on available Azure metadata and configuration at the time of execution. As such:

Results may not fully reflect actual application behavior, dependencies, or runtime resiliency.
Certain edge cases, service-specific behaviors, or architectural nuances may not be captured.
Azure services, features, and behaviors are subject to change over time.
This tool does not replace architecture validation, resiliency testing, or design reviews.

Customers are responsible for:

Validating all findings
Performing appropriate testing (including failover and recovery scenarios)
Ensuring alignment with their specific requirements, policies, and risk posture
No warranties, guarantees, or support obligations are provided with this tool.

Script version : 2.18
Script Last update : 27-03-2026
##>

#Requires -Modules Az.ResourceGraph,Az.Accounts,Az.Storage
param (
    [Parameter(mandatory=$false)]
    [string]$tenantscope,
    [Parameter(mandatory=$false)]
	[array]$customerTags=@(),
    [Parameter(mandatory=$false)]
    [string]$exportstoragesubid,
    [Parameter(mandatory=$false)]
    [string]$exportstorageAccount    ,
    [Parameter(mandatory=$true)]
    [string]$localexport=$true,
    [Parameter(mandatory=$false)]
    [array]$targetSubscriptions=@(),
    [Parameter(mandatory=$false)]
    [array]$managementGroupId=@()
)



Function Get-AllAzGraphResource {
    param (
        [string[]]$subscriptionId,
        [string]$query = 'Resources | project id,name, kind, location, resourceGroup, subscriptionId, sku, plan, zones, properties,tags'
    )
  
    [string]$query = 'Resources | project id,name, kind, location, resourceGroup, subscriptionId, sku, plan, zones, properties,tags | where id !has "Microsoft.Compute/snapshots" | where tags.Environment  !in ("Development","UAT","DEV") '

    if ($subscriptionId) {
        $result = Search-AzGraph -Query $query -First 1000 -Subscription $subscriptionId

    }else{
        $result = Search-AzGraph -Query $query -First 1000 -UseTenantScope
    }

    # Collection to store all resources
    $allResources = @($result)
  
    # Loop to paginate through the results using the skip token
    while ($result.SkipToken) {
        # Retrieve the next set of results using the skip token
        # $result = $subscriptionId ? (Search-AzGraph -Query $query -SkipToken $result.SkipToken -Subscription $subscriptionId -First 1000) : (Search-AzGraph -query $query -SkipToken $result.SkipToken -First 1000 -UseTenantScope)
        
        if ($subscriptionId) {
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -Subscription $subscriptionId
    
        }else{
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -UseTenantScope
        }
        
        
        # Add the results to the collection
        $allResources += $result
    }

    return  $allResources 
}

Function Get-AzBAckupASR {
    param (
        [string[]]$subscriptionId
    )

    $query = "recoveryservicesresources
        | where ['type'] in ('microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems','microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems')
            | extend vmId = case(
                properties.backupManagementType == 'AzureIaasVM', tolower(tostring(properties.dataSourceInfo.resourceID)),
                type == 'microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems', tolower(tostring(properties.providerSpecificDetails.dataSourceInfo.resourceId)),
                ''
            )
            | extend asrId = iff(type == 'microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems', tolower(tostring(strcat_array(array_slice(split(properties.recoveryFabricId, '/'), 0, 8), '/'))), '')
            | extend resourceId = case(
                properties.backupManagementType == 'AzureIaasVM', vmId,
                type == 'microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems', asrId,
                ''    )
            | extend Backup = tostring(properties.protectionStatus)
            | extend replicationHealth = properties.replicationHealth
            | extend failoverHealth = properties.failoverHealth
            | extend protectionStateDescription = properties.protectionStateDescription
            | extend isReplicationAgentUpdateRequired = properties.providerSpecificDetails.isReplicationAgentUpdateRequired
           // | project resourceId, vmId, asrId, Backup, replicationHealth, failoverHealth, protectionStateDescription, isReplicationAgentUpdateRequired
        | order by ['resourceId'] asc
        | order by ['resourceGroup'] asc"


    $result = Search-AzGraph -Query $query -First 1000 -Subscription $subscriptionId

    # Collection to store all resources
    $allResources = @($result)
  
    # Loop to paginate through the results using the skip token
    while ($result.SkipToken) {
        # Retrieve the next set of results using the skip token
        # $result = $subscriptionId ? (Search-AzGraph -Query $query -SkipToken $result.SkipToken -Subscription $subscriptionId -First 1000) : (Search-AzGraph -query $query -SkipToken $result.SkipToken -First 1000 -UseTenantScope)
        
        if ($subscriptionId) {
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -Subscription $subscriptionId
    
        }else{
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -UseTenantScope
        }
        
        
        # Add the results to the collection
        $allResources += $result
    }

    return  $allResources 

}

Function Get-AllRetirements {
    param (
        [string[]]$subscriptionId
        #,[string]$query 
    )


    $query = "resources
| extend ServiceID= case(
type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('basic_a0','basic_a1','basic_a2','basic_a3','basic_a4','standard_a0','standard_a1','standard_a2','standard_a3','standard_a4','standard_a5','standard_a6','standard_a7','standard_a9')  or tostring(sku.name) in~ ('basic_a0','basic_a1','basic_a2','basic_a3','basic_a4','standard_a0','standard_a1','standard_a2','standard_a3','standard_a4','standard_a5','standard_a6','standard_a7','standard_a9')),60
,type == 'microsoft.web/hostingenvironments' and kind in ('ASEV1','ASEV2'),13
,type == 'microsoft.compute/virtualmachines' and isempty(properties.storageProfile.osDisk.managedDisk),84
,type == 'microsoft.dbforpostgresql/servers' ,86
,type == 'microsoft.dbformysql/servers'  ,243
,type == 'microsoft.network/loadbalancers' and sku.name=='Basic',94
,type == 'microsoft.operationsmanagement/solutions' and plan.product=='OMSGallery/ServiceMap',213
,type == 'microsoft.insights/components' and isempty(properties.WorkspaceResourceId) ,181
,type == 'microsoft.classicstorage/storageaccounts',7
,type == 'microsoft.classiccompute/domainnames', 38
,type == 'microsoft.dbforpostgresql/servers' and properties.version == '11',225
,type == 'microsoft.logic/integrationserviceenvironments',139
,type == 'microsoft.classicnetwork/virtualnetworks',88
,type == 'microsoft.network/applicationgateways' and properties.sku.tier in~ ('Standard','WAF'),298
,type == 'microsoft.classicnetwork/reservedips',8802
,type == 'microsoft.classicnetwork/networksecuritygroups',8801
,type =~ 'Microsoft.CognitiveServices/accounts' and kind=~'QnAMaker',76
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_HB60rs','Standard_HB60-45rs','Standard_HB60-30rs','Standard_HB60-15rs')  or tostring(sku.name) in~ ('Standard_HB60rs','Standard_HB60-45rs','Standard_HB60-30rs','Standard_HB60-15rs')) ,62
,type contains 'Microsoft.MachineLearning/',40
,type =~ 'Microsoft.Network/publicIPAddresses' and sku.name=='Basic',220
,type =~ 'Microsoft.CognitiveServices/accounts' and kind contains 'LUIS',160
,type contains 'Microsoft.TimeSeriesInsights',31
,type =~ 'microsoft.dbforpostgresql/servers' and properties.version == '11',249
,type contains 'microsoft.media/mediaservices',394
,type =~ 'microsoft.maps/accounts' and (sku has 'S1' or sku has 'S0'),465
,type =~ 'microsoft.insights/webtests' and properties.Kind =~ 'ping',154
,type =~ 'microsoft.healthcareapis/services',354
,type =~ 'microsoft.healthcareapis' and properties.authenticationConfiguration.smartProxyEnabled =~ 'true',387
,type contains 'Microsoft.DBforMariaDB',398
,type =~ 'microsoft.cache/redis' and properties['minimumTlsVersion'] in ('1.1','1.0') ,403
,type =~ 'microsoft.cognitiveservices/accounts' and kind == 'Personalizer', 408
,type =~ 'microsoft.cognitiveservices/accounts' and kind == 'AnomalyDetector', 405
,type =~ 'microsoft.cognitiveservices/accounts' and kind == 'MetricsAdvisor', 407
,type =~ 'microsoft.cognitiveservices/accounts' and kind == 'ContentModerator', 561
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_M192is_v2')  or tostring(sku.name) in~ ('Standard_M192is_v2')) ,495
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_M192ims_v2')  or tostring(sku.name) in~ ('Standard_M192ims_v2')) ,496
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_M192ids_v2')  or tostring(sku.name) in~ ('Standard_M192ids_v2')) ,497
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_M192idms_v2')  or tostring(sku.name) in~ ('Standard_M192idms_v2')) ,498
,type contains 'microsoft.storagecache/caches' ,500
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_NC6s_v3','Standard_NC12s_v3','Standard_NC24s_v3')  or tostring(sku.name) in~ ('Standard_NC6s_v3','Standard_NC12s_v3','Standard_NC24s_v3')) ,514
,type contains 'microsoft.network/applicationgateways' and properties['sku']['tier'] in ('WAF_v2') and isnotnull(properties['webApplicationFirewallConfiguration']), 519
,type contains 'microsoft.dashboard/grafana' and (properties.grafanaMajorVersion == 9),554
,type contains 'HDInsight' and  (strcat(split(properties.clusterVersion,'.')[0],'.',split(properties.clusterVersion,'.')[1])) in ('4.0'), 562
,type contains 'HDInsight' and  (strcat(split(properties.clusterVersion,'.')[0],'.',split(properties.clusterVersion,'.')[1])) in ('5.0'), 563
,type contains 'microsoft.compute/virtualmachine' and  (tostring(properties.hardwareProfile.vmSize) in~ ('Standard_NC24rs_v3')  or tostring(sku.name) in~ ('Standard_NC24rs_v3')) ,582
,type contains 'Microsoft.ApiManagement/service' and tolower(properties.platformVersion) != tolower('stv2') ,204
,type contains 'microsoft.network/virtualnetworkgateways' and (tostring(properties.sku.name) in~ ('Standard')  or tostring(properties.sku.name) in~ ('HighPerformance') )
and tostring(properties.gatewayType) contains ('Vpn'), 481
,-9999)
| where ServiceID >0
| project ServiceID , id, resourceGroup, location
|union
(resources
    | where type == 'microsoft.synapse/workspaces/bigdatapools' and todouble(properties.sparkVersion) == 3.2
    | extend workspaceId = tostring(split(id,'/')[8])
    | join (
            Resources
            | where type == 'microsoft.synapse/workspaces' and properties.adlaResourceId == ''
            | project workspaceId = name
                ) on workspaceId
| project ServiceID = 583 , id, resourceGroup, location)
|union 
(
    AdvisorResources
    | where type =='microsoft.advisor/recommendations'
    | where properties.shortDescription contains 'Cloud service caches are being retired'
    | project id=tolower(tostring(properties.resourceMetadata.resourceId))
    | join 
    (
        resources
        | where type contains 'microsoft.cache/redis'
        | project id=tolower(id), resourceGroup, location
    ) on id
    | project ServiceID=124 , id, resourceGroup, location 
)
"
    
    if ($subscriptionId) {
        $result = Search-AzGraph -Query $query -First 1000 -Subscription $subscriptionId
    
    }else{
        $result = Search-AzGraph -Query $query -First 1000 -UseTenantScope
    }
    
    # Collection to store all resources
    $allResources = @($result)
    
    # Loop to paginate through the results using the skip token
    while ($result.SkipToken) {
        # Retrieve the next set of results using the skip token
        if ($subscriptionId) {
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -Subscription $subscriptionId
    
        }else{
            $result = Search-AzGraph -Query $query -SkipToken $result.SkipToken -First 1000 -UseTenantScope
        }
        # Add the results to the collection
        $allResources += $result
    }
  
    return  $allResources 
}
  
function parse-object {
    param ([string[]]$text)
    $parsed = ($text -replace ' (\w+=)', "`n`$1" ) -replace '[@{};]', '' | % { [pscustomobject] (ConvertFrom-StringData $_) }  
    return $parsed
}



######################## Update as per cusomter environemnt ####################


#$automatedVMresiliency  Groups the VMs wuing the customer tags provided. IF VMs are part of different AZ autimatically marks vms as zoneredundant 
# If tags are not properly set , this will lead false positives 
#  you can set this to false and manully override the zone rsiliency for vms using an excel workbook 

$automatedVMresiliency=$false

######################## Update as per cusomter environemnt ####################

  
# Ensures you do not inherit an AzContext in your runbook
Disable-AzContextAutosave -Scope Process



If (-not $(Get-AzContext)) {

    #check if running under automation account or local powershell
    IF($PSPrivateMetadata.JobId -or $env:AUTOMATION_ASSET_ACCOUNTID)
    {
        $AzureContext =(Connect-AzAccount -Identity).context

        #if user managed identity will be used , update the connection string with userid
        #$AzureContext =(Connect-AzAccount -Identity -AccountId <userid>).context
    }else{
        $AzureContext = (Connect-AzAccount).context
    }
}else{
    $AzureContext=Get-AzContext
}

# Set and store context
$AzureContext = Set-AzContext -SubscriptionName $AzureContext.Subscription -DefaultProfile $AzureContext

    


IF ($tenantscope) {
    $sublist = Get-AzSubscription -TenantId $tenantscope
}Else {

    $sublist = Get-AzSubscription 
}

If ($managementGroupId.Count -gt 0) {
    $mgSubIds = @()
    foreach ($mg in $managementGroupId) {
        Write-Output "Resolving subscriptions under Management Group: $mg"
        $mgSubs = Search-AzGraph -Query "ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId" -ManagementGroup $mg -First 1000
        $mgSubIds += $mgSubs | Select-Object -ExpandProperty subscriptionId
    }
    $mgSubIds = $mgSubIds | Select-Object -Unique
    $sublist = $sublist | Where-Object { $_.Id -in $mgSubIds }
    Write-Output "$($sublist.Count) subscription(s) found across $($managementGroupId.Count) Management Group(s)"
}

If ($targetSubscriptions.Count -gt 0) {
    $sublist = $sublist | Where-Object { $_.Id -in $targetSubscriptions -or $_.Name -in $targetSubscriptions }
    Write-Output "$($sublist.Count) subscription(s) matched from targetSubscriptions filter"
}




$jobs = @()

$dt = (Get-Date).ToString("yyyyMMddhhmm")
$datecolumn = (Get-Date).ToString("yyyy-MM-dd")

Write-Output "$dt - Scanning subscriptions!"

$retirements = @()
$mainReport = @()
$lbreport = @()
$pipreport = @()
$zonemapping=@()
$asrbackup = @()
$RetirementsDownloadUri='https://raw.githubusercontent.com/Volkanco/AzureDeploy/refs/heads/master/ReliabilityAssessment/AzureRetirements.json'
$runlog=@()



#optional resource type filter 
$filter = @()

# $filter=('Microsoft.Compute','Microsoft.RecoveryServices')

$error.Clear()


If(Get-Item -Path  $(get-date).ToString('yyyyMMdd') -ErrorAction SilentlyContinue)
{
    $folder=Get-Item -Path  $(get-date).ToString('yyyyMMdd')
    
    #Clean up any files from previous runs
    Get-ChildItem -Path $folder.FullName |   Remove-Item -Force


}else{
    $folder=new-item  -name $(get-date).ToString('yyyyMMdd')   -ItemType Directory
}





Write-Output "$(($sublist | where { $_.state -eq 'Enabled'}).count) subscriptions found"



#### ADD Trim to all tags 
#remove nonprod subscriptios

#$sublist=$sublist| where {$_.name -notlike  '*DEV*' -and $_.name -notlike '*UAT*' -and $_.name -notlike '*POC*'}
$scount=($sublist | where { $_.state -eq 'Enabled'}).count
$sc=1


Write-Output "$(($sublist | where { $_.state -eq 'Enabled'}).count) subscriptions found (Disabled subscriptions removed from scan) - Starting scan now !!!!"




foreach ($sub in $sublist | where { $_.state -eq 'Enabled' }) {

    Write-Output "############################################################"
    Write-Output  $sub 
    Write-Output "############################################################"
    if((get-azcontext).Subscription.id -ne $sub.Id){
    Set-AzContext -Subscription $sub.Id |Out-Null
    start-sleep -s 3 }
    


	remove-variable mainreport -force  -ErrorAction SilentlyContinue
	remove-variable lbreport -force -ErrorAction SilentlyContinue
	remove-variable pipreport -force  -ErrorAction SilentlyContinue
	remove-variable zonemapping -force -ErrorAction SilentlyContinue
	remove-variable asrbackup -force -ErrorAction SilentlyContinue
	remove-variable Allres -force -ErrorAction SilentlyContinue
	remove-variable rtype -force -ErrorAction SilentlyContinue
	remove-variable reslist -force -ErrorAction SilentlyContinue



	[System.GC]::Collect()


    Write-Output "Processing $($sub.name)      - ($sc / $scount) , total memory $([System.GC]::GetTotalMemory($true)/1024/1024)"
    $sc++


    Write-Output "`n`r"

    $mainReport = @()

    $lbreport = @()
    $pipreport = @()
    $zonemapping=@()
    $asrbackup = @()
	$MasterReport = @()
	
	
	    $Allres = Get-AllAzGraphResource -subscriptionId $sub.Id

    Write-Output "$($Allres.count) resources found under  $($sub.name)"
	
	
	   $runlog+= New-Object PSObject -Property @{ 
                    Subscription       = $($sub.name) -join ','
                    Subscriptionid = $($sub.id) -join ','
                    ResCount  	    =$($Allres.count)  -join ','
                    MemoryUsage     = $([System.GC]::GetTotalMemory($true)/1024/1024)
                }
	
	
	### Add a filter to remove resources like Microsoft.Compute/snapshots to reduce memory footprint .
	#microsoft.insights/scheduledqueryrules
	
	$allres=$allres|where{$_.id -notlike '*Microsoft.Compute/snapshots*'}
	
	
    
    if($($Allres.count) -gt 0){
    
    $retirements += Get-AllRetirements -subscriptionId $sub.Id 
    #add resource type

    $asrbackup_ = @()
    $asrbackup_ = Get-AzBAckupASR -subscriptionId $sub.Id

    $asrbackup_ | ForEach-Object {
        $t=$_

        If ($t.type -eq 'microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems') {
            Add-Member -InputObject $t -Name ProtectionType -Value "Backup" -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name backupManagementType -Value $t.Properties.backupManagementType -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name currentProtectionState -Value $t.Properties.currentProtectionState -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name protectedPrimaryRegion -Value $t.Properties.protectedPrimaryRegion -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name sourceResourceId -Value $t.Properties.sourceResourceId -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name lastBackupStatus -Value $t.Properties.lastBackupStatus -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name lastBackupTime -Value $t.Properties.lastBackupTime -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name protectedItemType -Value $t.Properties.protectedItemType -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name backupManagementType -Value $t.Properties.backupManagementType -MemberType Noteproperty -Force
            #Add-Member -InputObject $t -Name resourceName -Value $($t.ResourceId.Split('/')[$t.ResourceId.Split('/').count - 1]) -MemberType Noteproperty -Force

        
            Switch ($t.Properties.protectedItemType)
            {
                'Microsoft.Compute/virtualMachines'
                {            
                     $res=$null
                    $res=$($t.ResourceId.Split('/')[$t.ResourceId.Split('/').count - 1])
                    Add-Member -InputObject $t -Name resourcename -Value $res.split(';')[3] -MemberType Noteproperty -Force}
                'AzureFileShareProtectedItem'
                {    
                     $res=$null
                    $res=$($t.Properties.sourceResourceId.Split('/')[$t.Properties.sourceResourceId.Split('/').count - 1])
                    Write-Output "$res|$($t.name)"

                    Add-Member -InputObject $t -Name resourcename -Value "$res|$($t.name)"  -MemberType Noteproperty -Force
                    }
                'AzureVmWorkloadSQLDatabase'
                {    
                    $res=$null
                    $res=$($t.ResourceId.Split('/')[$t.ResourceId.Split('/').count - 1])
                    Add-Member -InputObject $t -Name resourcename -Value $res  -MemberType Noteproperty -Force}
                Default {
                         $res=$null
                    $res=$($t.ResourceId.Split('/')[$t.ResourceId.Split('/').count - 1])
                    Add-Member -InputObject $t -Name resourcename -Value $res  -MemberType Noteproperty -Forc
                }

            
            
            }




        }elseif ('microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems') {
            Add-Member -InputObject $t -Name ProtectionType -Value "ASR" -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name currentProtectionState -Value $t.Properties.currentProtectionState -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name primaryFabricLocation -Value $t.properties.providerSpecificDetails.primaryFabricLocation -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name recoveryFabricLocation -Value $t.properties.providerSpecificDetails.recoveryFabricLocation -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name primaryFabricProvider -Value $t.Properties.primaryFabricProvider -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name replicationHealth -Value $t.Properties.replicationHealth -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name failoverHealth -Value $t.Properties.failoverHealth -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name activeLocation -Value $t.Properties.activeLocation -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name sourceResourceId -Value $t.properties.providerSpecificDetails.dataSourceInfo.resourceId -MemberType Noteproperty -Force
            Add-Member -InputObject $t -Name resourceName -Value $($t.vmId.Split('/')[$t.vmId.Split('/').count - 1]) -MemberType Noteproperty -Force
        }
            #add date column for report 
            Add-Member -InputObject $t -Name ReportDate -Value $datecolumn -MemberType Noteproperty -Force
    }
    
    
    $asrbackup += $asrbackup_ | Select-Object -Property * -ExcludeProperty Properties

    #Get AZ Zone MApping for the sub 

    $response=$locations=$null
    $response = Invoke-AzRestMethod -Method GET -Path "/subscriptions/$($sub.Id)/locations?api-version=2022-12-01"
    $locations = ($response.Content | ConvertFrom-Json).value
    $locations|foreach{
        $t=$_

        IF($t.availabilityZoneMappings -ne $null)
        {
            $t.availabilityZoneMappings|foreach{
            
                $cu = New-Object PSObject -Property @{ 
                    Subscription       = $($sub.name) -join ','
                    Subscriptionid = $($sub.id) -join ','
                    ReportDate  	    =$datecolumn -join ','
                    location     = $t.name -join ','
                    availabilityzone   = $_.logicalZone -join ','
                    physicalzone  = $($_.physicalZone)
                }
                $zonemapping+=$cu
            }
        }else{
            $cu = New-Object PSObject -Property @{ 
                Subscription       = $($sub.name) -join ','
                Subscriptionid = $($sub.id) -join ','
                ReportDate  	    =$datecolumn -join ','
                location     = $t.name -join ','
                availabilityzone   = "NoAZRegion" -join ','
                physicalzone  = $t.name
            }
            $zonemapping+=$cu

    }
    
    }



	  $splitSize = 5000
	  $spltlist = @()
    If ($Allres.count -gt $splitSize) {
        
        $spltlist += for ($Index = 0; $Index -lt $Allres.count; $Index += $splitSize) {
            , ($Allres[$index..($index + $splitSize - 1)])
        }
		
		
    
	}else{
		$spltlist+='.'
		$spltlist[0]=$Allres
	}
	
	
	
	   Write-Output "Processing $($allres.count) resources in $($spltlist.count)  batch  -  , total memory $([System.GC]::GetTotalMemory($true)/1024/1024)"




##### Split start

    Foreach($mainReport in $spltlist)
	{


	$mainReport| Foreach-Object{
		$obj=$_
        $split = $obj.id.Split('/')
        Add-Member -InputObject $obj -Name ResourceType -Value $split[6] -MemberType Noteproperty -Force
        Add-Member -InputObject $obj -Name ResourceSubType -Value $($split[6] + "/" + $split[7]) -MemberType Noteproperty -Force
        Add-Member -InputObject $obj -Name Subscription -Value $($sub.name) -MemberType Noteproperty -Force
        #add date column for report 
        Add-Member -InputObject $obj -Name ReportDate -Value $datecolumn -MemberType Noteproperty -Force

        If ($obj.resourceid -like '*Microsoft.Network/loadBalancers*') {               
 
            $obj.properties.frontendipconfigurations | ForEach-Object {
                $cu = New-Object PSObject -Property @{ 
                    name       = $obj.name -join ','
                    ReportDate       = $datecolumn -join ','
                    resourceid = $obj.ResourceId -join ','
                    FEName     = $_.name -join ','
                    FEIpConf   = $_.id -join ','
                    FEIpZones  = $($_.zones -join " ")
                }
                
                $lbreport += $cu
            }             

        }


        If ($obj.resourceid -like '*Microsoft.Network/publicIPAddresses*') {
 
            $ipcfg = $nic = $vmid = $usingresid = $null
            if ($obj.properties.ipConfiguration) {
                If ($obj.properties.ipConfiguration.id -like '*Microsoft.Network/networkInterfaces*') {
                    Write-Output "Checking NIC for $($obj.properties.ipAddress)"
                    
                    $ipcfg = $obj.properties.ipConfiguration.id.split('/')[0..8] -join '/'
                    Write-Output "VMID $($ipcfg)"
                    
                    $nic = $mainReport | where { $_.resourceid -eq $ipcfg }
                    #$nic.name
                    #$nic.virtualMachin
                    # $nic|fl
                    $usingresid = $nic.properties.virtualMachine.id
            
                }else{
                    $usingresid = $obj.properties.ipConfiguration.id.split('/')[0..8] -join '/'
              
                }
            }

            $HA = $null
            if ($($obj.zones -join " ").Length -eq 0) { $HA = "Non-Zonal" }
            if ($($obj.zones -join " ").Length -eq 1) { $HA = "Zonal" }
            if ($($obj.zones -join " ").Length -eq 2) { $HA = "ZoneRedundant" }

            $cu = New-Object PSObject -Property @{ 
                name         = $obj.name -join ','
                reportdate   = $datecolumn  -join ','
                resourceid   = $obj.ResourceId -join ','
                IpConf       = $obj.properties.ipConfiguration.id -join ','
                IPAddress    = $obj.properties.ipAddress -join ','
                IPAllocation = $obj.properties.publicipallocationmethod -join ','
                IpZones      = $($obj.zones -join " ") -join ','
                Redundancy   = $HA -join ','
                UsingResId   = $usingresid
            }
            
            $pipreport += $cu
        }

        #get all tags 

        $obj.tags.PSObject.Properties | ForEach-Object {

            IF ($_.Name -ne $null -and $_.Name -ne 'Name' ) {

                Add-Member -InputObject $obj -Name $_.Name -Value ($_.value).tostring().Trim() -MemberType Noteproperty -Force -ErrorAction SilentlyContinue
            }
            IF ($_.Name -eq 'Name' ) {

                Add-Member -InputObject $obj -Name "Tag_$($_.Name)" -Value ($_.value).tostring().Trim() -MemberType Noteproperty -Force -ErrorAction SilentlyContinue

            }

        }

        Add-Member -InputObject $obj -Name CreationTime -Value $obj.properties.creationTime -MemberType Noteproperty -Force
    } 



        
    if ($filter) {
        $reslist = $mainReport| Select-Object Resourcetype -Unique | where { $_.ResourceType -in $filter }
    }else{
        $reslist = $mainReport | Select-Object Resourcetype -Unique
    }


IF ($mainReport) {
    foreach ($rtype in $reslist ) {
        $report = @()

        $Report = $mainReport | where { $_.Resourcetype -eq $rtype.ResourceType }

      #  Foreach ($obj in $list) {
       #     $report += $obj
       # }


           $helperSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $allProps =$null
        $allProps = foreach ($obj in $report) { 
            foreach ($prop in $obj.psobject.Properties.Name) {
                if ($helperSet.Add($prop)) { $prop.TOLOWER() }
            }
        }
		

        New-Variable -Name $rtype.ResourceType -Value $($Report | Select-Object -Property $allProps) -Force
		
		#memory exception
     
    }
}Else{
    Write-Output "No data collected !!!! Check if you have reader permission on the Azure Subscriptions"
    Write-Output "Subscription list"
    Get-AzSubscription
}


#No need to export csv for this ue the $retirements 
<#
If ( $retirements.count -eq 0) {

    "id,name,kind,location,resourceGroup,subscriptionId,sku,plan,zones,properties,tags,ResourceId" |  Out-File "$($folder.FullName)\Retirements.csv" -Append 


}Else{
    $retirements | Select  id,name,kind,location,resourceGroup,subscriptionId,sku,plan,zones,properties,tags,ResourceId | Export-Csv "$($folder.FullName)\Retirements.csv" -NoTypeInformation -Append  -Encoding utf8 

}


#>




### Add backup and ASR info to collected data 


Write-Output "Collecting Backup and ASR Data"
$asrbackup | ForEach-Object {
    $b = $_
    $t = $null
    if ($b.ProtectionType -eq 'Backup') {
        
        $t = $mainReport | where { $_.resourceid -eq $b.sourceResourceId }
        if ($t) {
            Add-Member -InputObject $t -Name BackupEnabled -Value $true -MemberType Noteproperty -Force 
            Add-Member -InputObject $t -Name LastBackup -Value "$($b.lastBackupStatus) - $($b.lastBackupTime.tostring("yyyy-MM-ddThh:mm")) " -MemberType Noteproperty -Force 
        }
        
    }Else{
        $t = $null
        $t = $mainReport | where { $_.resourceid -eq $b.sourceResourceId }

        If ($t) {
            Add-Member -InputObject $t -Name ASREnabled -Value "Enabled" -MemberType Noteproperty -Force 
            Add-Member -InputObject $t -Name ASRConfig -Value "$($_.primaryFabricLocation)-to-$($_.recoveryFabricLocation)" -MemberType Noteproperty -Force 
        }
       
   
    }
           
}


$allProps = @('id', 'name', 'type','ReportDate', 'tenantId', 'kind', 'location', 'resourceGroup', 'subscriptionId', 'managedBy', 'sku', 'plan', 'tags', 'identity', 'zones', 'extendedLocation', 'vmId', 'asrId', 'ResourceId', 'Backup', 'replicationHealth', 'failoverHealth', 'protectionStateDescription', 'isReplicationAgentUpdateRequired', 'ProtectionType', 'currentProtectionState', 'protectedPrimaryRegion', 'sourceResourceId', 'lastBackupStatus', 'lastBackupTime', 'protectedItemType', 'backupManagementType', 'resourceName', 'primaryfabriclocation', 'recoveryfabriclocation', 'primaryfabricprovider', 'activelocation')


$asrbackup | Select-Object -Property $allProps  | Export-Csv "$($folder.FullName)\asr_backup.csv" -NoTypeInformation -Append -Encoding utf8 


$allProps=$null

Write-Output "Exporting Zone mapping and PIPs"
Write-Output "`n`r"

$lbreport | Export-Csv "$($folder.FullName)\lbReport.csv" -NoTypeInformation -Append -Encoding utf8 
$pipreport | Export-Csv "$($folder.FullName)\pipReport.csv" -NoTypeInformation -Append -Encoding utf8 
$zonemapping| Export-Csv "$($folder.FullName)\zonemapping.csv" -NoTypeInformation -Append -Encoding utf8 



Write-Output "Start processing exported data"
Write-Output "`n`r"


$reportlist = $reslist
$baseProps = @('name', 'location', 'kind', 'resourceGroup', 'subscriptionId', 'subscription','ReportDate', 'ResourceId' , 'ResourceSubType', 'provisioningState', 'CreationTime', 'sku', 'zones', 'BackupEnabled', 'LastBackup','properties')
$processed = @()
#first load , storage , disks, Public Ips to resolve dependencies 




$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Storage' }
if ($file) {

    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $storage = ${Microsoft.Storage}


    $storage | Group-Object ResourceSubType | Select-Object  name , count


    $resProps = @('accessTier', 'skuname', 'skutier')
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $storage | Select-Object -Property $props

    #$storage | Select-Object -Property name, location, kind, resourceGroup, subscriptionId, subscription, ResourceId, ResourceSubType, provisioningState, CreationTime, sku, zones, BackupEnabled, LastBackup, accessTier, skuname, skutier

    foreach ($item in $subreport) {

        If ($item.sku -eq $null) {
            $recommendationId = 'e6c7e1cc-2f47-264d-aa50-1da421314472'

            $sku = ($waraoutput.ImpactedResources | where { $_.id -eq $item.resourceid -and $_.recommendationId -eq $recommendationId }).param1
            
        
            Add-Member -InputObject $item -Name sku -Value $sku.Split()[1] -MemberType Noteproperty -Force 

        }
        


        Add-Member -InputObject $item -Name skuname -Value $item.sku.name -MemberType Noteproperty -Force 


        If ($item.skuname -eq $null) { $storageHA = "NoInformation" }
        If ($item.skuname -like '*ZRS') { $storageHA = "ZoneRedundant" }
        If ($item.skuname -like '*GRS') { $storageHA = "GeoRedundant" }
        If ($item.skuname -like '*LRS') { $storageHA = "LocallyRedundant" }

        Add-Member -InputObject $item -Name ResiliencyConfig -Value $storageHA -MemberType Noteproperty -Force 

        

    }

    $Masterreport += $subreport

	remove-variable subreport  -force -ErrorAction SilentlyContinue
}

remove-variable storage  -force -ErrorAction SilentlyContinue


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Network' }
if ($file) {

    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $nw = ${Microsoft.Network}

    $pip = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/publicIPAddresses' }
    


    $resProps = @('ipConfiguration', 'publicIPAllocationMethod', 'ipAddress')
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $pip | Select-Object -Property $props

    $subreport | Group-Object ResourceSubType | Select-Object  name , count

    $subreport | ForEach-Object {
        if ($_.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
        if ($_.zones.length -eq 0) { $HASetting = "NonZonal" }
        if ($_.zones.length -eq 1) { $HASetting = "Zonal" }
        if ($_.sku -like '*tier=Global*') { $HASetting = "Global" }


        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport


    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/dnsZones' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props

    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 


    }
    $Masterreport += $subreport

    #Microsoft.Network/dnsResolvers

    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/dnsResolvers' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props

    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 

    }
    $Masterreport += $subreport


    #Microsoft.Network/virtualNetworks


    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/virtualNetworks' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport

    #Microsoft.Network/routeTables


    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/routeTables' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport



    #Microsoft.Network/virtualWans

    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/virtualWans' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport


    #Microsoft.Network/privateLinkServices
    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/privateLinkServices' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport

    #Microsoft.Network/privateEndpoints
    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/privateEndpoints' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport

    #Microsoft.Network/networkWatchers
    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/networkWatchers' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport



    #Microsoft.Network/virtualRouters"
    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/virtualRouters' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport


  $tempTable = $null
  $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/bastionHosts' }

  $resProps = @()
  $props = $baseProps + $resProps + $customerTags

  $subreport = @()
  $subreport = $tempTable | Select-Object -Property $props
  $subreport | ForEach-Object {


    if ($_.zones.Length -eq 0) { $haSetting = "NonZonal" }
    if ($_.zones.Length -eq 1) { $haSetting = "Zonal" }
    if ($_.zones.Length -gt 1) { $haSetting = "ZoneRedundant" }    


    Add-Member -InputObject $_ -Name ResiliencyConfig -Value $haSetting -MemberType Noteproperty -Force

  }
  $Masterreport += $subreport

    
    #Microsoft.Network/ddosProtectionPlans
    $tempTable = $null
    $tempTable = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/ddosProtectionPlans' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props
    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport


    #Microsoft.Network/virtualNetworkGateways

    $vnetgw = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/virtualNetworkGateways' }


    $resProps = @('ipConfigurations')
    $props = $baseProps + $resProps + $customerTags



    $subreport = @()
    $subreport = $vnetgw | Select-Object -Property $props

    $subreport | ForEach-Object {
        If ($_.properties.sku.name -like '*AZ*') { $HASetting = "ZoneRedundant" }elseif ($_.properties.sku.name -eq 'Basic' -or $_.properties.sku.name -match 'Gw[1-9]' ) { $HASetting = "LocallyRedundant" }

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force 
        If ($_.properties.sku.name -like '*ErGw*') { Add-Member -InputObject $_ -Name kind -Value "ER" -MemberType Noteproperty -Force }else {
            Add-Member -InputObject $_ -Name kind -Value "VPN" -MemberType Noteproperty -Force
        }


        #check public ips   $gws.properties.ipConfigurations.properties.publicipaddress
     
        $ipc = $null
        $ipc = ($_.properties.ipConfigurations)
        if ( $pipreport | where { $_.ipconf -eq $ipc.id } ) {


            Add-Member -InputObject $_ -Name PublicIP -Value $(($pipreport | where { $_.ipconf -eq $ipc.id }).ipaddress -join ' ') -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name PuplicIpZones -Value $(($pipreport | where { $_.ipconf -eq $ipc.id }).IpZones -join ' ') -MemberType Noteproperty -Force

        }

 

    }

    $Masterreport += $subreport



    $azfw = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/azureFirewalls' }

    $resProps = @('ipconfigurations', 'publicIPAddress')
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $azfw | Select-Object -Property $props

    $subreport | ForEach-Object {

        $fwpipdetail = ""
        $fwiplist = ""
        foreach ($ip in $($_.properties.ipconfigurations )) {

            $fwpip = $fwpipzone = $null
            $fwpip = $pipreport | where { $_.resourceid -eq $ip.properties.publicIPAddress.id } | select name , IPAddress, IPzones

            if ($fwpip.IpZones.Length -eq 0) { $fwpipzone = "$($fwpip.IPAddress)-NonZonal" }
            if ($fwpip.IpZones.Length -eq 1) { $fwpipzone = "$($fwpip.IPAddress)-Zonal" }
            if ($fwpip.IpZones.Length -gt 1) { $fwpipzone = "$($fwpip.IPAddress)-ZoneRedundant" }        
            $fwpipdetail += "$fwpipzone ,"    
            $fwiplist += "$($fwpip.IPAddress),"  
        }

        if ($_.zones.Length -eq 0) { $haSetting = "NonZonal" }
        if ($_.zones.Length -eq 1) { $haSetting = "Zonal" }
        if ($_.zones.Length -gt 1) { $haSetting = "ZoneRedundant" }    


        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $haSetting -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value $fwpipdetail -MemberType Noteproperty -Force        
        Add-Member -InputObject $_ -Name PublicIP -Value $fwiplist -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name PublicIPZones -Value $fwpipdetail -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name privateIPAddress -Value $ip.properties.privateIPAddress -MemberType Noteproperty -Force 

        $_.properties.ipconfigurations = ($_.properties.ipconfigurations -split "`r`n") -join " "
    }
    $Masterreport += $subreport

    $lb = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/loadBalancers' }
    $resProps = @('frontendIPConfigurations', 'backendAddressPools')
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $lb | Select-Object -Property $props
    $subreport | ForEach-Object {
        $t = $null
        $t = ($_.properties.frontendipconfigurations)

        #check public or internal 
        If ($t[0].properties.psobject.Properties.name -contains 'privateIPAddress') {
            Add-Member -InputObject $_ -Name kind -Value 'Internal' -MemberType Noteproperty -Force
        }Else {
            Add-Member -InputObject $_ -Name kind -Value 'Public' -MemberType Noteproperty -Force
        }

        $lbip = @()
        foreach ($fip in $t) {
            $fip | select name , zones
            #$fip.zones -join ","

            $ip = $lbip = $lbzones = $null
     
            IF ($pipreport) {
                $ip = $pipreport | where { $_.ipConf -eq $fip.id }
            }else {
                $ip = $pip | where { $_.ipConfiguration -eq $fip.id }
            }       

            if ($ip) {
    
                Write-Output " PIP found $($ip.name)  | $($($ip.ipzones))"
            
                $lbip += $ip.ipaddress

                if ($ip.ipzones.length -ge 2 -or $ip.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
                if ($ip.ipzones.length -eq 0 ) { $HASetting = "NonZonal" }
                if ($ip.ipzones.length -eq 1 -or $ip.zones.length -eq 1) { $HASetting = "Zonal" }               
            } 
            
            $lbzones += $fip.zones -join " " 
        }
       # IF ($_.frontendIPConfigurations) { $_.frontendIPConfigurations = ($_.frontendIPConfigurations -split "`r`n") -join " " }
       # if ($_.backendAddressPools) { ($_.backendAddressPools = $_.backendAddressPools -split "`r`n") -join " " }
      
        if ($lbip.length -gt 0) {
            Add-Member -InputObject $_ -Name PublicIP -Value $($lbip -join ', ') -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force
        }ElseIf ($lbzones.length -gt 1 ) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name zones -Value $lbzones -MemberType Noteproperty -Force
        }

        If ($lbzones.length -eq 1 ) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "Zonal" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name zones -Value $lbzones -MemberType Noteproperty -Force
        }
        If ($lbzones.length -eq 0 ) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force

        }

        #Overwrite for Global LB

        If ($_.sku -like '*Global*') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "Global" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name kind -Value "Public-Global" -MemberType Noteproperty -Force
        }
    }
    $Masterreport += $subreport


    $appgw = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/applicationGateways' }
    $resProps = @('backendAddressPools', 'autoscaleConfigurationminCapacity', 'autoscaleConfigurationmaxCapacity')
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $appgw | Select-Object -Property $props
    $subreport | ForEach-Object {
        if ($_.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
        if ($_.zones.length -eq 0) { $HASetting = "NonZonal" }
        if ($_.zones.length -eq 1) { $HASetting = "Zonal" }
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name BackendPoolNodeCount -Value ($_.properties.backendAddressPools)[0].properties.backendIPConfigurations.id.count -MemberType Noteproperty -Force
        $_.psobject.Properties.remove('backendAddressPools')
    }
    $Masterreport += $subreport


    $er = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/expressRouteCircuits' }
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $er  | Select-Object -Property $props
    $subreport | ForEach-Object {
        $sku = $_.sku
       
        Add-Member -InputObject $_ -Name skuname -Value $sku.name -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name skutier -Value $sku.tier -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name skufamily -Value $sku.family -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force 

    }
    $Masterreport += $subreport

    $erport = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/expressRoutePorts' }
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $erport | Select-Object -Property $props
    $subreport | ForEach-Object {        
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport

    $localgw = $nw | where { $_.ResourceSubType -eq 'microsoft.network/localnetworkgateways' }
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $localgw | Select-Object -Property $props
    $subreport | ForEach-Object {
       
        Add-Member -InputObject $_ -Name PublicIP -Value $_.gatewayipaddress -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport

    $nat = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/natGateways' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $nat | Select-Object -Property $props

    $subreport | ForEach-Object {

        IF ([string]::IsNullOrEmpty($_.zones)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force 
        }Else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "Zonal" -MemberType Noteproperty -Force 
        }        
    }
    $Masterreport += $subreport

    $tm = $nw | where { $_.ResourceSubType -eq 'Microsoft.Network/trafficManagerProfiles' }
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags
    $subreport = @()
    $subreport = $tm | Select-Object -Property $props
    $Masterreport += $subreport
	
	remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable nw  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Compute' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)  " -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $Compute = ${Microsoft.Compute}

    $compute|Group-Object -Property ResourceSubType |Select-Object Name,count

    $vms = $Compute | where { $_.ResourceSubType -eq 'Microsoft.Compute/virtualMachines' -and $_.ResourceId -notlike '*/extensions/*' }
    $extensions = $Compute | where { $_.ResourceSubType -eq 'Microsoft.Compute/virtualMachines' -and $_.ResourceId -like '*/extensions/*' }

    $disks = $Compute | where { $_.ResourceSubType -eq 'Microsoft.Compute/disks' }


    $resProps = @('Disksku', 'Disktier' , 'diskMBpsReadWrite'  , 'diskIOPSReadWrite' , 'NMW_OS_DESCRIPTION')
    $props = $baseProps + $resProps + $customerTags

    $subreportd = @()
    $subreportd = $disks | Select-Object -Property $props

    $subreportd | ForEach-Object {

        $storageHA = $null
        If ($_.sku.name -like '*ZRS' ) { $storageHA = "ZoneRedundant" }
        If ($_.sku.name  -like '*LRS'   ) { $storageHA = "LocallyRedundant" }
    
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $storageHA -MemberType Noteproperty -Force 

    }

 





    $resProps = @('VMsize', 'OSDiskName', 'OSDiskId', 'networkprofile', 'ASREnabled', 'ASRConfig', 'availabilityset')
    $props = $baseProps + $resProps + $customerTags


    $subreport = @()
    $subreport = $vms | Select-Object -Property $props



    foreach ($item in $subreport) {
       # $raw = $vms | where { $_.resourceid -eq $item.resourceid }
        $str = $item.properties.storageProfile 

        If ($str[0].osDisk.managedDisk.storageAccountType) {
            Add-Member -InputObject $item -Name OsDiskSku -Value $str[0].osDisk.managedDisk.storageAccountType -MemberType Noteproperty -Force 
        }else {
            $tempd = ($disks | where { $_.id -eq $str[0].osDisk.managedDisk.id })
            If ($tempd) {
                Add-Member -InputObject $item -Name OsDiskSku -Value $tempd[0].sku.name -MemberType Noteproperty -Force 

            }else {
                Add-Member -InputObject $item -Name OsDiskSku -Value "VHD-Unmanaged" -MemberType Noteproperty -Force 
            }
        }

        #add VM name to resiliency details for each corelation 
        $subreportd| where {$_.ResourceId -eq  $item.properties.storageProfile.osDisk.managedDisk.id}|ForEach-Object{
            $t=$_
            Add-Member -InputObject $t -Name ResiliencyDetail -Value $item.name -MemberType Noteproperty -Force            
        }
                
        Add-Member -InputObject $item -Name DataDiskCount -Value $str[0].dataDisks.Count -MemberType Noteproperty -Force 



        IF ($str[0].dataDisks.Count -gt 0) {
            $ddisk = @()
            foreach ($d in $str[0].dataDisks) {
                $ddisk += $d.managedDisk.storageAccountType
                $subreportd| where {$_.ResourceId -eq  $d.managedDisk.id}|ForEach-Object{
                    $t=$_
                    Add-Member -InputObject $t -Name ResiliencyDetail -Value $item.name -MemberType Noteproperty -Force            
                }
            }

            $ddiskreport = $null
                ($ddisk | group -Property Name) | ForEach-Object {
                $ddiskreport += "$($_.group[0]) ($($_.Count)),"
            }
                
            Add-Member -InputObject $item -Name DataDiskSku -Value $ddiskreport -MemberType Noteproperty -Force 

        }    

        #check disk to detect redundancy 
        If ($item.OsDiskSku -eq $null -and $raw.DataDiskSku -notlike '*LRS*') { $storageHA = "NoInformation" }
        If ($item.OsDiskSku -like '*ZRS' -and $raw.DataDiskSku -notlike '*LRS*') { $storageHA = "ZoneRedundant" }
        If ($item.OsDiskSku -like '*LRS' -and $raw.DataDiskSku -eq $null ) { $storageHA = "LocallyRedundant" }
        If ($item.OsDiskSku -like '*LRS' -and $raw.DataDiskSku -like '*LRS*' -and $raw.DataDiskSku -like '*ZRS*' ) { $storageHA = "LocallyRedundant!!!" }
        If ($item.OsDiskSku -like 'VHD*' -and $raw.DataDiskSku -like '*LRS*' -and $raw.DataDiskSku -like '*ZRS*' ) { $storageHA = "VHD-Unmanaged" }



        $vmz = "$null"
        if ($item.zones -gt 0) { $vmz = "Zonal" }else { 
            $vmz = "NonZonal" 
        }


        Add-Member -InputObject $item -Name StorageResiliency -Value $storageHA -MemberType Noteproperty -Force 
        If( $storageHA -eq "ZoneRedundant"){
            Add-Member -InputObject $item -Name ResiliencyConfig -Value $storageHA -MemberType Noteproperty -Force 
        }else{
            Add-Member -InputObject $item -Name ResiliencyConfig -Value "$vmz" -MemberType Noteproperty -Force
        }
         
        Add-Member -InputObject $item -Name ResiliencyDetail -Value "$vmz with $storageHA disks" -MemberType Noteproperty -Force
        $ip = $pipreport | where { $_.UsingResId -eq $item.resourceid }



        if ($ip) {
            Add-Member -InputObject $item -Name PublicIp -Value "$($ip[0].ipaddress)" -MemberType Noteproperty -Force 
            
            $HASetting = $null

            if ($ip[0].zones.length -gt 2) { $HASetting = "ZoneRedundant" }
            if ($ip[0].zones.length -eq 0 -or ($null -eq $ip[0].zones)) { $HASetting = "NonZonal" }
            if ($ip[0].zones.length -eq 1) { $HASetting = "Zonal" }
            
            Add-Member -InputObject $item -Name PublicIpZones -Value $_.zones -MemberType Noteproperty -Force 

        }

        #chnage nw profile to singleline sting 
       #$item.networkprofile = ($item.properties.networkprofile -split "`r`n") -join " "

        if ($item.backupenabled -eq $true) {
            Add-Member -InputObject $item -Name BackupDetails -Value "Enabled" -MemberType Noteproperty -Force 
        }



        If ($item.ResiliencyConfig -like 'Local*' -and $item.availabilityset -ne $null) {
            Add-Member -InputObject $item -Name ResiliencyDetail -Value "AVset: $((parse-object $item).id.split('/')[8])" -MemberType Noteproperty -Force 
        

        }

    

    }



    IF($automatedVMresiliency)
    {
        [array]$tempprops=$null
        [array]$tempprops+="subscription"
        [array]$tempprops+="resourcegroup"
        [array]$tempprops+=$customerTags 
        
        $subreport| group-object -property   $tempprops|foreach-object{
            $t=$_

    
            if ( ($t.group |select name, zones , resourcesubtype,tags | where {$_.zones -ne $null}|select -expandproperty zones |group-object).length -gt 1 )
            {

                #MArk these VMs as zoneRedundant
            
                $t1=$t.group| where {$_.zones -ne $null}
                
                Foreach($obj in $t1)
                {
            # write-output "will update $obj"

                        Add-Member -InputObject $obj -Name ResiliencyConfig -Value "$($obj.ResiliencyDetail) VM with multiple instances running ZR " -MemberType Noteproperty -Force

                        Add-Member -InputObject $obj -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
                                                                $obj | select name ,ResiliencyConfig 
                
                }

            }

        }

        #update disk redundancy setting  of already redundant vms 

        $subreport | where {$_.ResiliencyConfig -eq "ZoneRedundant"}|foreach{
                    $t1=$_
            
                    foreach ($obj in $subreportd|where{$_.ResiliencyDetail -match $t1.Name -and $_.subscription -eq $t1.subscription -and $_.resourcegroup -eq $t1.resourcegroup})
                    {
                    
                    
                    #ignore disks redundancy , remove them from ZR % Calculation 
                    
                        Add-Member -InputObject $obj -Name ResiliencyDetail -Value "$($obj.ResiliencyDetail) disk config removed as VM is already ZR Deployment" -MemberType Noteproperty -Force

                        Add-Member -InputObject $obj -Name ResiliencyConfig -Value "Ignore" -MemberType Noteproperty -Force	
                        
                        
                    }
            
        }
        
    }
    $Masterreport += $subreport
	$Masterreport += $subreportd

    $VMss = $Compute | where { $_.ResourceSubType -eq 'Microsoft.Compute/virtualMachineScaleSets' -and $_.ResourceId -notlike '*/extensions/*' }

    $resProps = @('orchestrationMode', 'zoneBalance')
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $vmss | Select-Object -Property $props

    $subreport | ForEach-Object {


        If ($_.Zones.length -eq 0) { $resHA = "NonZonal" }
        If ($_.Zones.length -eq 1) { $resHA = "Zonal" }
        If ($_.Zones.length -gt 1) { $resHA = "ZoneRedundant" }

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $resHA -MemberType Noteproperty -Force 


    }
    $Masterreport += $subreport



    #Microsoft.Compute/hostGroups

    $tempTable = $null
    $tempTable = $Compute | where { $_.ResourceSubType -eq 'Microsoft.Compute/hostGroups' }

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props

    $subreport | ForEach-Object {

        If ([string]::IsNullOrEmpty($_.Zones)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'Zonal' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Zone - $($_.Zones)" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable compute  -force -ErrorAction SilentlyContinue

}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.SQL' }
if ($file) {

    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $sql = ${Microsoft.SQL}
    $sql|Group-Object -Property ResourceSubType |Select-Object Name,count



    #Microsoft.Sql/managedInstances

    $tempTable = $null
    $tempTable = $sql | where { $_.ResourceSubType -eq 'Microsoft.Sql/managedInstances' }

    $resProps = @('maintenanceConfigurationId', 'zoneRedundant', 'requestedBackupStorageRedundancy')
    $props = $baseProps + $resProps + $customerTags

    $subreport = @()
    $subreport = $tempTable | Select-Object -Property $props

    $subreport | ForEach-Object {
        If($_.ResourceId -like '*/databases/*' )
        {
            Add-Member -InputObject $_ -Name ResourceSubType -Value 'Microsoft.Sql/managedInstances/databases' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ServerResId -Value  $($_.ResourceId.Split('/')[0..8] -join '/') -MemberType Noteproperty -Force 
        }Else{

            Add-Member -InputObject $_ -Name BackupDetails -Value "Storage : $($_.properties.requestedBackupStorageRedundancy)" -MemberType Noteproperty -Force  
        If ($_.zoneredundant -eq $true) { 
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
        }Else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }

        Add-Member -InputObject $_ -Name Maintenance -Value $_.properties.maintenanceConfigurationId -MemberType Noteproperty -Force 
        }
    }
    



    $subreport | where {$_.ResourceId -like '*/databases/*' }| ForEach-Object {
        $t=$_
        $srv=$null
        $srv= $subreport|where{$_.resourceid -eq $t.serverresid}
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $srv.ResiliencyConfig -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "$($srv.ResiliencyConfig) inherited from $($srv.name)" -MemberType Noteproperty -Force 

    }

    $Masterreport += $subreport


    $sqlservers = $sql | where { $_.ResourceSubType -eq 'Microsoft.Sql/servers' -and $_.ResourceId.split('/').count -eq 9 }
    #LOGICAL cONTAINER CHECK DATABASES 

    $resProps = @()
    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $sqlservers | Select-Object -Property $props

    $subreport | ForEach-Object {
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NotApply" -MemberType Noteproperty -Force
    }

    $Masterreport += $subreport




    $sqldbs = $sql | where { $_.ResourceSubType -eq 'Microsoft.Sql/servers' -and $_.Resourceid -like '*/databases/*' }  

    $resProps = @('requestedBackupStorageRedundancy', 'currentBackupStorageRedundancy', 'currentSku', 'defaultSecondaryLocation', 'zoneRedundant', 'availabilityZone','secondaryType')
    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $sqldbs |  Select-Object -Property $props




    $subreport | ForEach-Object {

        Add-Member -InputObject $_ -Name resourcesubtype -Value "Microsoft.Sql/databases" -MemberType Noteproperty -Force

        if ($_.properties.zoneRedundant -ne $false -and ![string]::IsNullOrEmpty($_.properties.zoneredundant)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        }

        Add-Member -InputObject $_ -Name PreferedAZ -Value $_.properties.availabilityZone -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name backupdetails -Value $_.properties.currentBackupStorageRedundancy -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name SecondaryLocation -Value $_.properties.defaultSecondaryLocation -MemberType Noteproperty -Force
        
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "ZoneRedundant:$($_.properties.zoneredundant), PreferedAZ: $($_.properties.availabilityzone) " -MemberType Noteproperty -Force
    
    }
 
    $subreport|where{$_.secondaryType -eq 'Geo'}|ForEach-Object{
        $t=$_
         $pri=$rconfig=$null
         $pri=$subreport|where{$_.Name -eq $t.Name}
         $rconfig=$pri.ResiliencyConfig
         Add-Member -InputObject $pri -Name ResiliencyConfig -Value "$rconfig+GeoReplica" -MemberType Noteproperty -Force
         Add-Member -InputObject $pri -Name ResiliencyDetail -Value "$($t.properties.secondaryType):$($t.location):$($t.name)" -MemberType Noteproperty -Force

         Add-Member -InputObject $t -Name ResiliencyDetail -Value "$($t.properties.secondaryType) replica for $($pri.name)" -MemberType Noteproperty -Force


     }


    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable sql  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.DocumentDB' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $docdb = ${Microsoft.DocumentDB}
    $docdb |Group-Object -Property ResourceSubType |Select-Object Name,count

    $resProps = @('nodeGroupSpecs', 'backuppolicy', 'enableMultipleWriteLocations', 'enableAutomaticFailover', 'consistencyPolicy' , 'locations' , 'writeLocations')
    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props


    $subreport = @()
    $subreport = $docdb |  Select-Object -Property $props

    $subreport | ForEach-Object {

        IF ($_.ResourceSubType -eq 'Microsoft.DocumentDb/databaseAccounts') {
            $loc = $wloc = $l1 = $l2 = $null

            $loc = $_.properties.locations 
            $wloc = $_.properties.writelocations 

            $l1 = ($_.properties.locations).locationname -join ", "

            foreach ($child in $loc) {
                $l2 += "$($child.locationName) , ZoneRedundant: $($child.isZoneRedundant)"

            }

            Add-Member -InputObject $_ -Name locations -Value $l1 -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value $l2 -MemberType Noteproperty -Force 

            If ($loc.count -gt 1) { Add-Member -InputObject $_ -Name ResiliencyConfig -Value "MultiRegion" -MemberType Noteproperty -Force }Elseif ($l2 -like '*false*') {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "LocallyRedundant" -MemberType Noteproperty -Force

            }else {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            }
    

          #  if ($_.locations) { ($_.locations = $_.locations -split "`r`n") -join " " }
          #  if ($_.writelocations) { ($_.writelocations = $_.writelocations -split "`r`n") -join " " }

        }elseif ($_.ResourceSubType -eq 'Microsoft.DocumentDB/mongoclusters') {

            If (($_.properties.nodeGroupSpecs).enableHA -eq $true) {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant_StanbyHA" -MemberType Noteproperty -Force
            }else {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "LocallyRedundant" -MemberType Noteproperty -Force
            }
        }
    
        
        

    }


    $Masterreport += $subreport

	remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable docdb  -force -ErrorAction SilentlyContinue



}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.DBforPostgreSQL' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $PSQL = ${Microsoft.DBforPostgreSQL}
    $PSQL|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('highAvailability' , 'replicationRole', 'HAState', 'HAMode', 'maintenanceWindow', 'backup', 'backupredundancy')
    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $psql | where { $_.ResourceSubType -eq 'Microsoft.DBforPostgreSQL/flexibleServers' }   |  Select-Object -Property $props     
    
    $subreport | ForEach-Object {

        
        Add-Member -InputObject $_ -Name customMaintenanceWindow -Value ($_.properties.maintenanceWindow).customWindow -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name backupRetentionDays -Value ($_.properties.backup).backupRetentionDays -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name geoRedundantBackup -Value ($_.properties.backup).geoRedundantBackup -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name backupIntervalHours -Value ($_.properties.backup).backupIntervalHours -MemberType Noteproperty -Force 


        # If ($_.properties.HAMode -eq 'Disabled') {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        #     Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        # }elseif ($_.properties.HAMode -eq 'SameZone') {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "SameZoneHA" -MemberType Noteproperty -Force
        #     Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        # }Else {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        #     if ($_.properties.availabilityZone) {

            
        #         Add-Member -InputObject $_ -Name Zones -Value "$($_.properties.availabilityZone) -stdby $($_.properties.standbyAZ)" -MemberType Noteproperty -Force
        #     }
        # }

                If ($_.properties.HAMode -eq 'Disabled' -or $_.properties.highAvailability.mode  -eq 'Disabled') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        }elseif ($_.properties.HAMode -eq 'SameZone'  -or $_.properties.highAvailability.mode  -eq  'SameZone' ) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "SameZoneHA" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        }Elseif($_.properties.HAMode -eq 'Enabled' -or $_.properties.highAvailability.mode  -eq 'ZoneRedundant') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            if ($_.properties.availabilityZone) {

           
                Add-Member -InputObject $_ -Name Zones -Value "$($_.properties.availabilityZone) -stdby $($_.properties.standbyAZ)" -MemberType Noteproperty -Force
            }
        }






























        Add-Member -InputObject $_ -Name ResiliencyDetail -Value $_.properties.highAvailability -MemberType Noteproperty -Force
        

        If (($_.properties.backup).geoRedundantBackup -eq 'Disabled') {
            Add-Member -InputObject $_ -Name BAckupDetails -Value "LocallyRedundant" -MemberType Noteproperty -Force
        }Elseif (($_.properties.backup).geoRedundantBackup -eq 'Enabled') {
            Add-Member -InputObject $_ -Name BAckupDetails -Value "GeoRedundant" -MemberType Noteproperty -Force

        }




    }

    $Masterreport += $subreport



    $psqlsrv = $psql | where { $_.ResourceSubType -eq 'Microsoft.DBforPostgreSQL/servers' }  

    $resProps = @('storageProfile', 'highAvailability' , 'replicationRole', 'HAState', 'HAMode', 'maintenanceWindow', 'backup', 'backupredundancy')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $psqlsrv |  Select-Object -Property $props

    $subreport | ForEach-Object {        

        Add-Member -InputObject $_ -Name BackupDetails -Value "GeoRedundant backup : $(($_.properties.storageProfile).geoRedundantBackup), Retention: $(($_.properties.storageProfile).backupRetentionDays) days" -MemberType Noteproperty -Force 
  
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force

    
        #if ($_.storageProfile) { ($_.storageProfile = $_.storageProfile -split "`r`n") -join " " }

        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "No Az Support for SKU" -MemberType Noteproperty -Force
    


    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable PSQL  -force -ErrorAction SilentlyContinue


}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.DBforMySQL' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $MySQL = ${Microsoft.DBforMySQL}
    $MySQL|Group-Object -Property ResourceSubType |Select-Object Name,count

    $mysqlflex = $mysql | where { $_.ResourceSubType -eq 'Microsoft.DBforMySQL/flexibleServers' }  

    $resProps = @('highAvailability' , 'replicationRole','sourceserverresourceid', 'HAState', 'HAMode', 'maintenanceWindow', 'backup', 'backupredundancy', 'standbyaz', 'availabilityzone')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props
    $subreport = @()
    $subreport = $mysqlflex |  Select-Object -Property $props

    $subreport | ForEach-Object {

        
        Add-Member -InputObject $_ -Name customMaintenanceWindow -Value ($_.properties.maintenanceWindow).customWindow -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name backupRetentionDays -Value ($_.properties.backup).backupRetentionDays -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name geoRedundantBackup -Value ($_.properties.backup).geoRedundantBackup -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name backupIntervalHours -Value ($_.properties.backup).backupIntervalHours -MemberType Noteproperty -Force 


        # If ($_.properties.HAMode -eq 'Disabled') {
        #     IF($_.properties.availabilityZone -gt 0)
        #     {
        #         Add-Member -InputObject $_ -Name ResiliencyConfig -Value "Zonal" -MemberType Noteproperty -Force
        #         Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        #     }Else{
        #         Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        #         Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        #     }

        # }elseif ($_.properties.HAMode -eq 'SameZone') {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "SameZoneHA" -MemberType Noteproperty -Force
        #     Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        # }Else {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        #     if ($_.properties.availabilityZone) {
        #         Add-Member -InputObject $_ -Name Zones -Value "$($_.properties.availabilityZone) -stdby $($_.properties.standbyAZ)" -MemberType Noteproperty -Force

        #     }
            
        # }

                If ($_.properties.HAMode -eq 'Disabled' -or $_.properties.highAvailability.mode  -eq 'Disabled') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        }elseif ($_.properties.HAMode -eq 'SameZone'  -or $_.properties.highAvailability.mode  -eq  'SameZone' ) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "SameZoneHA" -MemberType Noteproperty -Force
            Add-Member -InputObject $_ -Name Zones -Value $($_.properties.availabilityZone) -MemberType Noteproperty -Force
        }Elseif($_.properties.HAMode -eq 'Enabled' -or $_.properties.highAvailability.mode  -eq 'ZoneRedundant') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            if ($_.properties.availabilityZone) {

           
                Add-Member -InputObject $_ -Name Zones -Value "$($_.properties.availabilityZone) -stdby $($_.properties.standbyAZ)" -MemberType Noteproperty -Force
            }
        }






        Add-Member -InputObject $_ -Name ResiliencyDetail -Value $_.properties.highAvailability -MemberType Noteproperty -Force

        If (($_.properties.backup).geoRedundantBackup -eq 'Disabled') {
            Add-Member -InputObject $_ -Name BackupDetails -Value "LocallyRedundant" -MemberType Noteproperty -Force
        }Elseif (($_.properties.backup).geoRedundantBackup -eq 'Enabled') {
            Add-Member -InputObject $_ -Name BackupDetails -Value "GeoRedundant" -MemberType Noteproperty -Force

        }
      #  if ($_.backup) { ($_.backup = $_.backup -split "`r`n") -join " " }
      #  if ($_.maintenanceWindow) { ($_.maintenanceWindow = $_.maintenanceWindow -split "`r`n") -join " " }


    }

    
    $subreport|where{$_.properties.replicationRole -eq 'Replica'}|ForEach-Object{
        $t=$_
         $pri=$rconfig=$null
         $pri=$subreport|where{$_.ResourceId -eq $t.sourceserverresourceid}
         $rconfig=$pri.ResiliencyConfig
         Add-Member -InputObject $pri -Name ResiliencyConfig -Value "$rconfig+Replica" -MemberType Noteproperty -Force
         Add-Member -InputObject $pri -Name ResiliencyDetail -Value "$($t.properties.replicationRole):$($t.location):$($t.name)" -MemberType Noteproperty -Force

         Add-Member -InputObject $t -Name ResiliencyDetail -Value "$($t.properties.replicationRole) for $($pri.name)" -MemberType Noteproperty -Force

     }
 




    $Masterreport += $subreport

    $mysqlsrv = $mysql | where { $_.ResourceSubType -eq 'Microsoft.DBforMySQL/servers' }  

    $resProps = @('storageProfile', 'highAvailability' , 'replicationRole', 'HAState', 'HAMode', 'maintenanceWindow', 'backup', 'backupredundancy')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $mysqlsrv |  Select-Object -Property $props

    $subreport | ForEach-Object {        

        Add-Member -InputObject $_ -Name BackupDetails -Value "GeoRedundant backup : $(($_.properties.storageProfile).geoRedundantBackup), Retention: $(($_.properties.storageProfile).backupRetentionDays) days" -MemberType Noteproperty -Force 
  
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force

    
        #if ($_.storageProfile) { ($_.storageProfile = $_.storageProfile -split "`r`n") -join " " }

        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "No Az Support for SKU" -MemberType Noteproperty -Force
    


    }
    $Masterreport += $subreport

	remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable mysql  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Databricks' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType

    $dataBricks = ${Microsoft.Databricks}
    $dataBricks |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('parameters')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $dataBricks |  Select-Object -Property $props

    $subreport | ForEach-Object {

        $temp = $null
        $temp = $_

        Add-Member -InputObject $_ -Name storageAccountName -Value ($_.properties.parameters).storageAccountName.value -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name storageAccountSku -Value ($_.properties.parameters).storageAccountSkuName.value -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name publicIpName -Value ($_.properties.parameters).publicIpName.value -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name natGatewayName -Value ($_.properties.parameters).natGatewayName.value -MemberType Noteproperty -Force 
    
        $str = $str_res = $null
        $str = $storage | where { $_.name -eq ($temp.properties.parameters).storageAccountName.value }
        If ($str -like '*GRS*') { $str_res = "GeoRedundant" }
        If ($str -like '*ZRS*') { $str_res = "ZoneRedundant" }
        If ($str -like '*LRS*') { $str_res = "LocallyRedundant" }

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Control Plane and nodes are ZR" -MemberType Noteproperty -Force

        $_.psobject.Properties.remove('parameters')


    }

    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable databricks  -force -ErrorAction SilentlyContinue

}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.ContainerService' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $containers = ${Microsoft.ContainerService}
    $containers |Group-Object -Property ResourceSubType |Select-Object Name,count

    $resProps = @('agentPoolProfiles', 'nodeResourceGroup')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $containers |  Select-Object -Property $props

    $subreport | ForEach-Object {
      

        $agentpools = @()

        $zonal = 0
        $nonzonal = 0


        foreach ($obj in ($_.properties.agentPoolProfiles)) {
                     $agentpools += "$($obj.name),$($obj.osType),Zones:$($obj.availabilityZones)" 
          
        }
        foreach ($obj in $agentpools) {
                
            If ($obj.split(':')[1].length -gt 1) { $zonal++ }else { $nonzonal++ }
        }
        


        If ($agentpools.count -eq $zonal) { $HASetting = "ZoneRedundant" }elseif ($zonal -eq 0) { $HASetting = "LocallyRedundant" }Else { $HASetting = "PartiallyAzRedundant" }

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value $($agentpools -join ';') -MemberType Noteproperty -Force 

        # $_.psobject.Properties.remove('agentPoolProfiles')

    }


    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable containers  -force -ErrorAction SilentlyContinue

}


#report_Microsoft.ContainerRegistry  All ACRs are converted to ZR wherever we have zones.
$file = $reslist| where { $_.ResourceType -eq 'Microsoft.ContainerRegistry' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $table = ${Microsoft.ContainerRegistry}

    $table |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('zoneRedundancy', 'agentPoolProfiles', 'nodeResourceGroup')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $table |  Select-Object -Property $props

    $subreport | ForEach-Object {
      
        # If ($_.properties.zoneRedundancy -eq 'Enabled') {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        # }Else {
        #     Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        # }

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force

    }


    $Masterreport += $subreport
	
	remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable table  -force -ErrorAction SilentlyContinue

}


#report_Microsoft.ContainerRegistry
$file = $reslist| where { $_.ResourceType -eq 'Microsoft.ContainerInstance' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $table = ${Microsoft.ContainerInstance}
    $table |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $table |  Select-Object -Property $props

    $subreport | ForEach-Object {
      

        If ([string]::IsNullOrEmpty($_.Zones)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'Zonal' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Zone - $($_.Zones)" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }


    }


    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable table  -force -ErrorAction SilentlyContinue

}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Cache' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $cache = ${Microsoft.Cache}
    $cache |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('planName', 'isSpot', 'computeMode', 'zonalconfiguration')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $cache | Select-Object -Property $props

    $subreport | ForEach-Object {

        if ($_.ResourceSubType -eq 'Microsoft.Cache/Redis') {

          


                IF ($_.properties.zonalAllocationPolicy -eq 'Automatic') 
                { 
                    Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force  
                
                }elseif($_.properties.zonalAllocationPolicy -eq 'NoZones')
                { 
                    Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force  
                
                }
                        
         
            if ($_.properties.sku.name -eq 'Basic') {         
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force       
            }

        }
        
        
        
        if ($_.ResourceSubType -eq 'Microsoft.Cache/redisEnterprise') {

            $HASetting = $null
            if ([string]$_.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
            if ([string]$_.zones.length -eq 0) { $HASetting = "NonZonal" }
            if ([string]$_.zones.length -eq 1) { $HASetting = "Zonal" }

            Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force 
      
        }

    
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable cache  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Web' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $web = ${Microsoft.Web}
    $web |Group-Object -Property ResourceSubType |Select-Object Name,count
    $webfarms = $web | where { $_.ResourceSubType -eq 'Microsoft.Web/serverFarms' }


    $resProps = @('zoneRedundant', 'numberOfWorkers', 'elasticScaleEnabled')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $webfarms |  Select-Object -Property $props

    $subreport | ForEach-Object {

        if ($_.properties.zoneRedundant -ne  $false -and ![string]::IsNullOrEmpty($_.properties.zoneredundant)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        }
    }


    $Masterreport += $subreport
    $websites = $web | where { $_.ResourceSubType -eq 'Microsoft.Web/sites' }

    $resProps = @('redundancyMode', 'inboundIpAddress', 'availabilityState', 'storageAccountRequired', 'storageRecoveryDefaultState', 'enabled', 'serverfarmid')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $websites |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        $t = $t1 = $null
        $t = $_
        $t1 = $webfarms | where { $_.ResourceId -eq $t.properties.serverFarmId }
        
        if ($t1.properties.zoneRedundant -ne $false -and ![string]::IsNullOrEmpty($t1.properties.zoneredundant)) {
            Add-Member -InputObject $t -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $t -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        }
        Add-Member -InputObject $t -Name ComputeMode -Value $t1.properties.computeMode -MemberType Noteproperty -Force
        
        #rewriting function apps as Microsoft.Web/functionapp for easy filtering 

        if ($_.properties.kind -like '*functionapp*') {
            Add-Member -InputObject $t -Name ResourceSubType -Value "Microsoft.Web/functionapp" -MemberType Noteproperty -Force
        }
        if ($_.properties.kind -like '*workflowapp*') {
            Add-Member -InputObject $t -Name ResourceSubType -Value "Microsoft.Web/workflowapp" -MemberType Noteproperty -Force
        }
    }

    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable web  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Logic' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $LA = ${Microsoft.Logic}
    $LA   |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('zoneRedundant', 'status')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $LA |  Select-Object -Property $props
    $subreport | ForEach-Object {
        IF ($_.ResourceSubType -eq 'Microsoft.Logic/workflows') {

            if ($_.zones.length -eq 0) {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
            }
        }
    }    
    $Masterreport += $subreport
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Servicebus' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $sb = ${Microsoft.Servicebus}
    $sb |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('zoneRedundant', 'status')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props
    $subreport = @()
    $subreport = $sb |  Select-Object -Property $props

    $subreport | ForEach-Object { 
    
        if ($_.properties.zoneRedundant -ne $false -and ![string]::IsNullOrEmpty($t1.properties.zoneredundant)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
        }
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable sb  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.RecoveryServices' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $recsvc = ${Microsoft.RecoveryServices}
    $recsvc |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('standardTierStorageRedundancy', 'crossRegionRestore', 'crossSubscriptionRestoreSettings')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $recsvc |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $_.properties.redundancySettings.standardTierStorageRedundancy -MemberType Noteproperty -Force
        Add-Member -InputObject $_ -Name ResiliencyDetail -Value "crossRegionRestore  : $($_.properties.redundancySettings.crossRegionRestore)" -MemberType Noteproperty -Force
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	remove-variable recsvc  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.DataProtection' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $bkpsvc = ${Microsoft.DataProtection}
    $bkpsvc |Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('storageSettings')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $bkpsvc |  Select-Object -Property $props

    $subreport | ForEach-Object { 
    $t=$_
    IF($_.storageSettings -ne 'System.Object[]')
    {
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $(($_.properties.storageSettings).type)  -MemberType Noteproperty -Force  |Out-Null
    }

    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue

}



$file = $reslist| where { $_.ResourceType -eq 'Microsoft.EventGrid' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $evgrd = ${Microsoft.EventGrid}
    $evgrd|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('isZoneRedundant', 'topicType')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $evgrd |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        if($_.ResourceSubType -eq 'Microsoft.EventGrid/namespaces' ){
            if ($_.properties.isZoneRedundant -eq $true) {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            }else{
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
            }
        }

        if($_.ResourceSubType -eq 'Microsoft.EventGrid/systemTopics' -or $_.ResourceSubType -eq 'Microsoft.EventGrid/Topics' ){

                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
            
        }
        Add-Member -InputObject $_ -Name Kind -Value $_.properties.topicType -MemberType Noteproperty -Force
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.EventHub' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $eh = ${Microsoft.EventHub}
    $eh|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('zoneRedundant')

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $eh |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        if($_.ResourceSubType -eq 'Microsoft.EventHub/namespaces' ){
            if ($_.properties.zoneRedundant -eq $true) {
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "ZoneRedundant" -MemberType Noteproperty -Force
            }Else{
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NonZonal" -MemberType Noteproperty -Force
            }    
        } 

    }
    $Masterreport += $subreport
		remove-variable subreport  -force -ErrorAction SilentlyContinue

}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.KeyVault' }
if ($file) {   
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    
    $kv = ${Microsoft.KeyVault}
    $kv|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $kv |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        if ($_.ResourceSubType -eq 'Microsoft.KeyVault/vaults') {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
        }Else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value "NoInfo" -MemberType Noteproperty -Force
        }
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Kusto' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $kusto = ${Microsoft.Kusto}
    $kusto|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $kusto |  Select-Object -Property $props

    $subreport | ForEach-Object { 
        if ($_.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
        if ($_.zones.length -eq 0) { $HASetting = "NonZonal" }
        if ($_.zones.length -eq 1) { $HASetting = "Zonal" }
      
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force
    }
    $Masterreport += $subreport
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.StreamAnalytics' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.StreamAnalytics}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()

    $props = $baseProps + $resProps + $customerTags
    #| select-object -Property $props

    $subreport = @()
    $subreport = $Table  |  Select-Object -Property $props

    $subreport | ForEach-Object { 

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
    }
    $Masterreport += $subreport
	
		remove-variable subreport  -force -ErrorAction SilentlyContinue
	
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Automation' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.Automation}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  Select-Object -Property $props
    $subreport | ForEach-Object { 
        Add-Member -InputObject $_ -Name ResiliencyConfig -Value "RedundantbyDefault" -MemberType Noteproperty -Force
    }
    $Masterreport += $subreport
	
			remove-variable subreport  -force -ErrorAction SilentlyContinue
}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.NetApp' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.NetApp}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.NetApp/netAppAccounts/volumeGroups' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        If ([string]::IsNullOrEmpty($_.Zones)) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'Zonal' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Zone - $($_.Zones)" -MemberType Noteproperty -Force
        }else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }
    }
    $Masterreport += $subreport
	
			remove-variable subreport  -force -ErrorAction SilentlyContinue
}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.NotificationHubs' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.NotificationHubs}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.NotificationHubs/namespaces' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
    }
    $Masterreport += $subreport
	
			remove-variable subreport  -force -ErrorAction SilentlyContinue

}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.DataFactory' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.DataFactory}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @()
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.DataFactory/factories' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'GeoRedundantbyDefault' -MemberType Noteproperty -Force 

    }
    $Masterreport += $subreport
	
			remove-variable subreport  -force -ErrorAction SilentlyContinue
}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.ApiManagement' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.ApiManagement}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('outboundPublicIPAddresses', 'additionalLocations', 'gatewayRegionalUrl', 'privateIPAddresses', 'platformVersion', 'natGatewayState')

    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.ApiManagement/service' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        # Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'GeoRedundantbyDefault' -MemberType Noteproperty -Force 
  
        $capacity = $null
        $capacity = $_.sku.capacity


        IF ($capacity -gt 1) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
        }Else {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'Zonal' -MemberType Noteproperty -Force 
        }
    }
    $Masterreport += $subreport
	
			remove-variable subreport  -force -ErrorAction SilentlyContinue
}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.Search' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.Search}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('replicaCount', 'partitionCount')

    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.Search/searchServices' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        If ($_.properties.replicaCount -gt 1) {
            #zoneredundant
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Replicas: $($_.properties.replicaCount)" -MemberType Noteproperty -Force 

        }Elseif ($_.properties.replicaCount -eq 1) {
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'Zonal' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name ResiliencyDetail -Value "Replicas: $($_.properties.replicaCount)" -MemberType Noteproperty -Force 

        }
    }
    $Masterreport += $subreport
			remove-variable subreport  -force -ErrorAction SilentlyContinue
}


$file = $reslist| where { $_.ResourceType -eq 'Microsoft.SignalRService' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.SignalRService}
    $resProps = @()
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.SignalRService/signalR'  -or $_.ResourceSubType -eq 'Microsoft.SignalRService/WebPubSub'} |  Select-Object -Property $props
    $subreport | ForEach-Object { 

        If ($_.sku.tier  -eq 'Premium' -or $_.sku -like '*Premium*') {
            #zoneredundant
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 

        }Else{
            Add-Member -InputObject $_ -Name ResiliencyConfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }
    }
    $Masterreport += $subreport
	

}

# Microsoft.OperationalInsights/workspaces
$file = $reslist| where { $_.ResourceType -eq 'Microsoft.OperationalInsights' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.OperationalInsights}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('availability')
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.OperationalInsights/workspaces' } |  Select-Object -Property $props
    $locationswithaz=@('canadacentral','southcentralus','westus3','australiaeast','centralindia','southeastasia','francecentral','italynorth','northeurope','norwayeast',
    'spaincentral','swedencentral','uksouth','israelcentral','uaenorth')
    $subreport | ForEach-Object { 
 
            if($_.location -in $locationswithaz)
            {
                Add-Member -InputObject $_ -Name resiliencyconfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
                Add-Member -InputObject $_ -Name resiliencydetail -Value 'ZonalRedundantRegion' -MemberType Noteproperty -Force 

            }else{
                Add-Member -InputObject $_ -Name resiliencyconfig -Value 'RedundantbyDefault' -MemberType Noteproperty -Force 
                Add-Member -InputObject $_ -Name resiliencydetail -Value 'LocalRedundantRegion' -MemberType Noteproperty -Force 

            }
    }
    $Masterreport += $subreport


    

    #Microsoft.OperationalInsights/clusters
    $resProps = @('isAvailabilityZonesEnabled')
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.OperationalInsights/clusters' } |  Select-Object -Property $props
    $locationswithaz=@()
    $subreport | ForEach-Object { 
 
            if($_.properties.isAvailabilityZonesEnabled -eq $true)
            {
                Add-Member -InputObject $_ -Name resiliencyconfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
            }else{
                Add-Member -InputObject $_ -Name resiliencyconfig -Value 'LocallyRedundant' -MemberType Noteproperty -Force 

            }
    }
    $Masterreport += $subreport



}

$file = $reslist| where { $_.ResourceType -eq 'Microsoft.AVS' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.AVS}
    $resProps = @('availability')
    $props = $baseProps + $resProps + $customerTags 
    $subreport = @()
    $subreport = $Table |  where { $_.ResourceSubType -eq 'Microsoft.AVS/privateClouds' } |  Select-Object -Property $props
    $subreport | ForEach-Object { 
 
        Add-Member -InputObject $_ -Name HAStrategy -Value $(($_.properties.availability).strategy) -MemberType Noteproperty -Force 
        Add-Member -InputObject $_ -Name PrimaryZone -Value $(($_.properties.availability).zone) -MemberType Noteproperty -Force 

        If ($(($_.properties.availability).secondaryZone) ) {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name resiliencydetail -Value "SecondayZone: $(($_.properties.availability).secondaryZone)" -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name zone -Value "$(($_.properties.availability).zone)  $(($_.properties.availability).secondaryZone)" -MemberType Noteproperty -Force 

        }Else {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'Zonal' -MemberType Noteproperty -Force 
            Add-Member -InputObject $_ -Name zone -Value "$(($_.properties.availability).zone)" -MemberType Noteproperty -Force 
        }     

    }
    $Masterreport += $subreport
}
#
$file = $reslist| where { $_.ResourceType -eq 'Microsoft.App' }
if ($file) {
    Write-Host "Processing $($file.ResourceType)" -ForegroundColor Yellow -BackgroundColor Blue
    $processed += $file.ResourceType
    $table = $null
    $Table = ${Microsoft.App}
    $table|Group-Object -Property ResourceSubType |Select-Object Name,count
    $resProps = @('zoneredundant', 'managedEnvironmentId')
    $props = $baseProps + $resProps + $customerTags 
    $subreport1 = @()
    $subreport1 = $Table | where { $_.resourcesubtype -eq 'Microsoft.App/managedEnvironments' } | Select-Object -Property $props
    $subreport1 | ForEach-Object { 
        IF ($_.properties.zoneredundant -eq $true) {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
        
        }Else {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }      
     
    }

    $subreport2 = @()
    $subreport2 = $Table | where { $_.resourcesubtype -eq 'Microsoft.App/containerApps' } | Select-Object -Property $props
    $subreport2 | ForEach-Object { 

        $me = $null
        $me = $subreport1 | where { $_.resourceid -eq $_.properties.managedEnvironmentId }
        

        IF ($me.zoneredundant -eq $true) {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'ZoneRedundant' -MemberType Noteproperty -Force 
        
        }Else {
            Add-Member -InputObject $_ -Name resiliencyconfig -Value 'NonZonal' -MemberType Noteproperty -Force 
        }           
    }

    $Masterreport += $subreport1
    $Masterreport += $subreport2
}
#
#Check any other resource provider report s zones information

    foreach ($file in $reslist | where { $_.ResourceType -like 'Microsoft.*' -and $_.ResourceType -notin $processed }) {
        $csv = (Get-Variable | where {$_.name -eq $file.ResourceType}).value

        $resProps = @()

        $props = $baseProps + $resProps + $customerTags
        #| select-object -Property $props

        $subreport = @()
        $subreport = $csv |  Select-Object -Property $props

        $subreport | ForEach-Object {
            IF (![string]::IsNullOrEmpty($_.zones)){

                Write-Host "$($_.Name),$($_.Resourcesubtype),$($_.zones)  "   -ForegroundColor Green -BackgroundColor Blue

        
                if ($_.zones.length -ge 2) { $HASetting = "ZoneRedundant" }
                if ($_.zones.length -eq 0) { $HASetting = "NonZonal" }
                if ($_.zones.length -eq 1) { $HASetting = "Zonal" }
                Add-Member -InputObject $_ -Name ResiliencyConfig -Value $HASetting -MemberType Noteproperty -Force
            }else{
                Add-Member -InputObject $_ -Name ResiliencyDetail -Value "NoInfo" -MemberType Noteproperty -Force
            }
        }
        $Masterreport += $subreport    
    }




    #check and enrich asr/backup info 
    $recsvcmapping = Import-Csv "$($folder.FullName)\asr_backup.csv" -ErrorAction SilentlyContinue


    $recsvcmapping | ForEach-Object {
        $b = $_
        $t = $null
        if ($b.ProtectionType -eq 'Backup') {

            $recvaultid = $null
            $recvaultid = $b.ResourceId.Split('/')[0..8] -join '/'
            $vault = $recsvc | where { $_.resourceid -eq $recvaultid }
            $t = $Masterreport | where { $_.resourceid -eq $b.sourceResourceId }

            if ($t) {
                Add-Member -InputObject $t -Name BackupDetails -Value "Enabled -$($b.backup)- CRR:$($vault.crossRegionRestore)- Str:$($vault.standardTierStorageRedundancy) " -MemberType Noteproperty -Force 
                Add-Member -InputObject $t -Name LastBackup -Value "$($b.lastBackupStatus) - $($b.lastBackupTime) ) " -MemberType Noteproperty -Force 
            }
        
        }Else {
            $t = $null
            $t = $Masterreport | where { $_.resourceid -eq $b.sourceResourceId }
            $b.sourceResourceId
            If ($t) {
                Add-Member -InputObject $t -Name ASRDetails -Value "Enabled- RepHealth: ($b.replicationHealth)" -MemberType Noteproperty -Force 
                Add-Member -InputObject $t -Name ASRConfig -Value "$($_.primaryFabricLocation)-to-$($_.recoveryFabricLocation)" -MemberType Noteproperty -Force 
            }  
        }
    }



    $filterProps =$Null
    $filterProps = @('name', 'location','reportdate','resourceGroup', 'subscriptionId', 'subscription', 'ResourceId' , 'ResourceSubType', 'sku', 'kind', 'zones', 'ResiliencyConfig', 'ResiliencyDetail', 'PublicIP', 'PublicIPZones', 'backupdetails', 'lastbackup', 'ASRDetails', 'ASRConfig', 'skuname', 'skutier', 'customMaintenanceWindow', 'customer_comments','physicalzone','MasterFilter')

    #hide some resources that does not have any resiliency configuration to clear up the dashboard

    $filteredresourcetypes = @('Microsoft.AlertsManagement/actionRules', 'Microsoft.AlertsManagement/prometheusRuleGroups', 'microsoft.alertsmanagement/smartDetectorAlertRules', 'microsoft.dashboard/grafana', 'Microsoft.DatabaseWatcher/watchers,
    Microsoft.DevTestLab/schedules', 'microsoft.insights/workbooks', 'microsoft.insights/scheduledqueryrules', 'microsoft.insights/privateLinkScopes', 'microsoft.insights/actiongroups', 'microsoft.insights/activityLogAlerts', 'Microsoft.Insights/autoscalesettings',
        'Microsoft.Insights/components', 'Microsoft.Insights/dataCollectionEndpoints', 'Microsoft.Insights/dataCollectionRules', 'microsoft.insights/metricalerts', 'Microsoft.Migrate/assessmentProjects', 'Microsoft.Migrate/migrateprojects', 'Microsoft.Migrate/moveCollections', 'Microsoft.OffAzure/HyperVSites',
        'Microsoft.OffAzure/MasterSites', 'Microsoft.OffAzure/VMwareSite', 'Microsoft.OperationsManagement/solutions', 'Microsoft.ManagedIdentity/userAssignedIdentities', 'Microsoft.Portal/dashboards', 'Microsoft.Resources/templateSpecs', 'Microsoft.SecurityCopilot/capacities', 'Microsoft.SaaS/resources', 'Microsoft.HybridCompute/machines', 'Microsoft.AzureArcData/SqlServerInstances')

    $MasterReport = $MasterReport | where { $_.ResourceSubType -notin $filteredresourcetypes }

    ## Add physical locations to masterreport 

    $MasterReport|foreach{
        $t=$_
        if($t.zones  -eq 1 -or $t.zones  -eq 2 -or $t.zones  -eq 3){
            $z=$null
            $z=$zonemapping|where{$_.subscriptionId -eq $t.subscriptionId -and $_.location -eq $t.location -and $_.availabilityZone -eq $t.zones }
            Add-Member -InputObject $t -Name physicalzone -Value $z.physicalzone -MemberType Noteproperty -Force 

        }Elseif($t.zones.Length -gt 1)
        {
            $ztemp=@()
            $t.zones.Split()|foreach{
                $t1=$_
                $ztemp+=($zonemapping|where{$_.subscriptionId -eq $t.subscriptionId -and $_.location -eq $t.location -and $_.availabilityZone -eq $t1 }).physicalzone
            }
            Add-Member -InputObject $t -Name physicalzone -Value $($ztemp -join ";") -MemberType Noteproperty -Force 
        }

        #check if its a no AZ region
        IF($t.zones.Length -eq 0)
        {
            $z=$null
            $z=$zonemapping|where{$_.subscriptionId -eq $t.subscriptionId -and $_.location -eq $t.location -and $_.availabilityzone -eq "NoAZRegion"}
            If($z)
            {
                Add-Member -InputObject $t -Name physicalzone -Value $z.name -MemberType Noteproperty -Force 
                Add-Member -InputObject $t -Name zones -Value "NoAZRegion" -MemberType Noteproperty -Force 
            }
        

        }


    }

    #recheck SubIDs and names


    $MasterReport|foreach{
        $t=$_
    
    
        if($t.Subscription -eq $t.subscriptionId){
            Write-Output "Sub guid found $($t.Subscription))"

            $t1=$MasterReport| where{$_.subscriptionId -eq $t.subscription -and $_.Subscription -ne $_.subscriptionId}   
            Add-Member -InputObject $t -Name Subscription -Value $t1[0].Subscription -MemberType Noteproperty -Force 

        }

        $customerTags|Foreach{
		    $t1=$_
		    if ($null -eq ($t.psobject.properties|where {$_.name -eq $t1}).value) {
			    $t.${t1}="N/A"
		    }

            $f=$null
            $f="$($t.Subscription), $($t.resourceGroup)"

            $customerTags|Foreach{
            $t2=$_
                $f+=", $($t.${t2})"
            }

            Add-Member -InputObject $t -Name MasterFilter -Value $f -MemberType Noteproperty -Force 
	
	    }


    }


    $dt = (Get-Date).ToString("yyyyMMddhhmm")

    $MasterReport|Group-Object -Property Subscription

    $Masterreport | Select-Object -Property $($filterProps + $customerTags) |     Export-Csv "$($folder.FullName)\MasterReport.csv" -NoTypeInformation -Encoding utf8  -Append 





	# split
		remove-variable MasterReport -force -ErrorAction SilentlyContinue
		
	
	}
	
	



    }


#Endforsub
}


############################################## Analyzer


# Download latest retirement announcements from github


Invoke-WebRequest -Uri $RetirementsDownloadUri -OutFile "$($folder.FullName)\Azureretirements.json"

$retirementsMaster = Get-Content "$($folder.FullName)\Azureretirements.json" | ConvertFrom-Json 



#convert all headers to lower case for powerbi 
$file = Get-Content "$($folder.FullName)\MasterReport.csv"
$firstline = $file[0]
$firstlinelower = $firstline.ToLower()
$tfile = $file | select -Skip 1 
@($firstlinelower) + $tfile | Set-Content "$($folder.FullName)\MasterReport.csv"

#finally merge retirements

#replace $customerretirements with $retirements
#$customerRetirements = Import-Csv "$($folder.FullName)\Retirements.csv"

$Retirements | ForEach-Object {
    $t = $_
   
    $r = $null
    $r = $retirementsMaster | where { $_.id -eq $t.Serviceid }
   
    Add-Member -InputObject $_ -Name ServiceName -Value $r.ServiceName -MemberType Noteproperty -Force
    Add-Member -InputObject $_ -Name RetiringFeature -Value $r.RetiringFeature -MemberType Noteproperty -Force
    Add-Member -InputObject $_ -Name RetirementDate -Value $r.RetirementDate -MemberType Noteproperty -Force
    Add-Member -InputObject $_ -Name Link -Value $r.Link -MemberType Noteproperty -Force
    #add date column for report 
    Add-Member -InputObject $_ -Name ReportDate -Value $datecolumn -MemberType Noteproperty -Force

}



If ( $retirements.count -eq 0) {

    "ServiceID,id,resourceGroup,location,ResourceId,ServiceName,RetiringFeature,RetirementDate,Link,ReportDate" |  Out-File "$($folder.FullName)\CustomerAzRetirements.csv" -Force  
}Else{
    $retirements | Export-Csv "$($folder.FullName)\CustomerAzRetirements.csv" -NoTypeInformation -Force -Encoding utf8 
}



#compressfolder for easy downloading in case running from  cloud shell 
Compress-Archive  "$($folder.FullName)\*.csv"  "$($folder.FullName).zip" -Force



if($localexport -eq $false)
{

	write-output "Start uploading files to $exportstorageAccount"
    #use powershell to upload files to the storage account specified

    $containerName = "reliabilityassessment"  



    Set-AzContext -Subscription $exportstoragesubid


    $Context = New-AzStorageContext -StorageAccountName $exportstorageAccount -UseConnectedAccount

    If (!(Get-AzStorageContainer -Name $containerName -Context $Context) )
    {

        New-AzStorageContainer -Name $containerName  -Permission Off -Context $Context
    }



    $files=Get-ChildItem -Path $folder.FullName

    Foreach ($file in $files)
    {
        $Blob1HT = @{
            File             = $file.FullName
            Container        = $ContainerName
            Blob             = "$($folder.name)\$($file.name)"
            Context          = $Context
            StandardBlobTier = 'Hot'
        }
        Set-AzStorageBlobContent @Blob1HT -Force 

    }

}
















