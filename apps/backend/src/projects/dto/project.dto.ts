import { IsString, IsOptional, IsEnum, IsDateString, IsObject, IsArray, IsInt, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectStatus, TemplateCategory, TemplateSubType, ComplianceType } from '@prisma/client';

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
  externalInternal?: string;

  @IsOptional()
  @IsInt()
  totalScopeCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NetworkScopeRow)
  networkScope?: NetworkScopeRow[];

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
  externalInternal?: string;

  @IsOptional()
  @IsInt()
  totalScopeCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NetworkScopeRow)
  networkScope?: NetworkScopeRow[];

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

export class ReviewProjectDto {
  @IsEnum(ProjectStatus)
  status: ProjectStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
