import { IsString, IsOptional, IsEnum, IsDateString, IsObject, IsArray, IsInt, IsIn, ValidateNested, IsEmail, MaxLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateCategory, TemplateSubType, ComplianceType } from '@prisma/client';

// A plain-object array with no nested validation class would have its
// entries stripped to {} by the global ValidationPipe's whitelist option —
// @ValidateNested + @Type is what tells class-validator/transformer these
// rows have real shape worth preserving.
export class NetworkScopeRow {
  @IsString()
  ip: string;

  @IsString()
  domainHostname: string;

  @IsString()
  purpose: string;
}

// {Tool Name} / {Tool Version} / {Open Source/Licensed} table rows.
export class ToolUsedRow {
  @IsString()
  name: string;

  @IsString()
  version: string;

  @IsString()
  licenseType: string;
}

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  clientName: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** @deprecated Ignored: the template is selected automatically from the project's category and Testing Type. */
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsEnum(ComplianceType)
  complianceType: ComplianceType;

  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @IsEnum(TemplateSubType)
  subType: TemplateSubType;

  // Report detail fields
  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSpocName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSpocDesignation?: string;

  // Optional; an empty string (cleared field) is allowed, anything else must look like an email address.
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsEmail()
  @MaxLength(255)
  clientSpocEmail?: string;

  @IsOptional()
  @IsString()
  documentVersion?: string;

  @IsOptional()
  @IsString()
  toolsUsed?: string;

  @IsOptional()
  @IsString()
  testingEnvironment?: string;

  @IsOptional()
  @IsString()
  qaReviewerName?: string;

  @IsOptional()
  @IsString()
  applicationDetails?: string;

  @IsOptional()
  @IsString()
  testingType?: string;

  @IsOptional()
  @IsString()
  loginSystemTypes?: string;

  @IsOptional()
  @IsString()
  applicationNature?: string;

  @IsOptional()
  @IsString()
  testingLimitation?: string;

  @IsOptional()
  @IsString()
  mobilePlatform?: string;

  @IsOptional()
  @IsString()
  sha1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  codeLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  systemUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  systemHostname?: string;

  @IsOptional()
  @IsString()
  externalInternal?: string;

  @IsOptional()
  @IsIn(['VA', 'PT', 'VAPT', ''])
  networkActivityType?: string;

  @IsOptional()
  @IsInt()
  totalScopeCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NetworkScopeRow)
  networkScope?: NetworkScopeRow[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolUsedRow)
  toolsUsedTable?: ToolUsedRow[];

  @IsOptional()
  @IsString()
  quarter?: string;

  @IsOptional()
  @IsObject()
  customFieldValues?: Record<string, string>;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** @deprecated Ignored: the template is selected automatically from the project's category and Testing Type. */
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsEnum(ComplianceType)
  complianceType?: ComplianceType;

  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSpocName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSpocDesignation?: string;

  // Optional; an empty string (cleared field) is allowed, anything else must look like an email address.
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsEmail()
  @MaxLength(255)
  clientSpocEmail?: string;

  @IsOptional()
  @IsString()
  documentVersion?: string;

  @IsOptional()
  @IsString()
  toolsUsed?: string;

  @IsOptional()
  @IsString()
  testingEnvironment?: string;

  @IsOptional()
  @IsString()
  qaReviewerName?: string;

  @IsOptional()
  @IsString()
  applicationDetails?: string;

  @IsOptional()
  @IsString()
  testingType?: string;

  @IsOptional()
  @IsString()
  loginSystemTypes?: string;

  @IsOptional()
  @IsString()
  applicationNature?: string;

  @IsOptional()
  @IsString()
  testingLimitation?: string;

  @IsOptional()
  @IsString()
  mobilePlatform?: string;

  @IsOptional()
  @IsString()
  sha1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  codeLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  systemUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  systemHostname?: string;

  @IsOptional()
  @IsString()
  externalInternal?: string;

  @IsOptional()
  @IsIn(['VA', 'PT', 'VAPT', ''])
  networkActivityType?: string;

  @IsOptional()
  @IsInt()
  totalScopeCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NetworkScopeRow)
  networkScope?: NetworkScopeRow[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolUsedRow)
  toolsUsedTable?: ToolUsedRow[];

  @IsOptional()
  @IsString()
  quarter?: string;

  @IsOptional()
  @IsString()
  complianceStatus?: string;

  @IsOptional()
  @IsObject()
  customFieldValues?: Record<string, string>;
}

export class ReassignProjectDto {
  @IsString()
  testerId: string;
}
