/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementClient, WebSiteManagementModels } from '@azure/arm-appservice';
import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { createWebSiteClient } from '../utils/azureClients';
import { nonNullProp } from '../utils/nonNull';
import { AppKind, LinuxRuntimes, WebsiteOS } from './AppKind';
import { IAppServiceWizardContext } from './IAppServiceWizardContext';

export class SiteRuntimeStep extends AzureWizardPromptStep<IAppServiceWizardContext> {
    public async prompt(wizardContext: IAppServiceWizardContext): Promise<void> {
        if (wizardContext.newSiteOS === WebsiteOS.linux) {
            wizardContext.newSiteRuntime = (await ext.ui.showQuickPick(
                this.getLinuxRuntimeStack(wizardContext).then(stacks => convertStacksToPicks(stacks, wizardContext.recommendedSiteRuntime)),
                { placeHolder: 'Select a runtime for your new Linux app.' })
            ).data;
        }
    }

    public shouldPrompt(wizardContext: IAppServiceWizardContext): boolean {
        return !wizardContext.newSiteRuntime && !(wizardContext.newSiteKind === AppKind.app && wizardContext.newSiteOS === WebsiteOS.windows);
    }

    private async getLinuxRuntimeStack(wizardContext: IAppServiceWizardContext): Promise<WebSiteManagementModels.ApplicationStack[]> {
        const client: WebSiteManagementClient = await createWebSiteClient(wizardContext);
        return await client.provider.getAvailableStacks({ osTypeSelected: 'Linux' });
    }
}

export function convertStacksToPicks(stacks: WebSiteManagementModels.ApplicationStack[], recommendedRuntimes: LinuxRuntimes[] | undefined): IAzureQuickPickItem<string>[] {
    function getPriority(data: string): number {
        // tslint:disable-next-line: strict-boolean-expressions
        recommendedRuntimes = recommendedRuntimes || [];
        const index: number = recommendedRuntimes.findIndex(r => r === data.toLowerCase());
        return index === -1 ? recommendedRuntimes.length : index;
    }

    return stacks
        // convert each "majorVersion" to an object with all the info we need
        // tslint:disable-next-line: strict-boolean-expressions
        .map(stack => (stack.majorVersions || []).map(mv => {
            const stackDisplay: string = nonNullProp(stack, 'display');
            return {
                runtimeVersion: nonNullProp(mv, 'runtimeVersion'),
                stackDisplay: stackDisplay,
                // include stack display in the display name only if it doesn't include a version number
                // this simplifies names such as 'Java 8 Tomcat 8.5' to just 'Tomcat 8.5'
                displayName: /[0-9]/.test(stackDisplay) ? nonNullProp(mv, 'displayVersion') : `${stackDisplay} ${nonNullProp(mv, 'displayVersion')}`
            };
        }))
        // flatten array
        .reduce((acc, val) => acc.concat(val))
        // filter out wildfly as they are removed from app service linux runtime option
        .filter(mv => !/wildfly/i.test(mv.runtimeVersion))
        // filter out Node 4.x, 6.x, and 6 LTS as they are EOL
        .filter(mv => !/node\|(4|6)[\.-]/i.test(mv.runtimeVersion))
        // filter out .NET Core 1.x and 2.0 as they are EOL
        .filter(mv => !/dotnetcore\|(1\.|2\.0)/i.test(mv.runtimeVersion))
        // sort
        .sort((a, b) => {
            const aInfo: IParsedRuntimeVersion = getRuntimeInfo(a.runtimeVersion);
            const bInfo: IParsedRuntimeVersion = getRuntimeInfo(b.runtimeVersion);
            if (aInfo.name !== bInfo.name) {
                const result: number = getPriority(aInfo.name) - getPriority(bInfo.name);
                if (result !== 0) {
                    return result;
                }
            } else if (aInfo.major !== bInfo.major) {
                return bInfo.major - aInfo.major;
            } else if (aInfo.minor !== bInfo.minor) {
                return bInfo.minor - aInfo.minor;
            }

            if (a.displayName !== b.displayName) {
                return a.displayName.localeCompare(b.displayName);
            } else {
                return a.stackDisplay.localeCompare(b.stackDisplay);
            }
        })
        // convert to quick pick
        .map(mv => {
            return {
                id: mv.runtimeVersion,
                label: mv.displayName,
                data: mv.runtimeVersion,
                // include stack as description if it has a version
                // tslint:disable-next-line: strict-boolean-expressions
                description: /[0-9]/.test(mv.stackDisplay) ? mv.stackDisplay : undefined
            };
        });
}

interface IParsedRuntimeVersion {
    name: string;
    major: number;
    minor: number;
}

function getRuntimeInfo(runtimeVersion: string): IParsedRuntimeVersion {
    const parts: string[] = runtimeVersion.split('|');

    let major: string | undefined;
    let minor: string | undefined;
    if (parts[1]) {
        const match: RegExpMatchArray | null = parts[1].match(/([0-9]+)(?:\.([0-9]+))?/);
        if (match) {
            major = match[1];
            minor = match[2];
        }
    }

    return {
        name: parts[0],
        major: convertToNumber(major),
        minor: convertToNumber(minor)
    };
}

function convertToNumber(data: string | undefined): number {
    if (data) {
        const result: number = parseInt(data);
        if (!isNaN(result)) {
            return result;
        }
    }
    return Number.MAX_SAFE_INTEGER;
}
