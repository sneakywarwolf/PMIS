import { PrismaClient, UserRole, ProjectStatus, FindingStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  // Set ADMIN_PASSWORD to choose one; otherwise a random password is generated and printed once.
  const adminPlain = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url') + '!Aa1';
  const adminPassword = await argon2.hash(adminPlain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const adminExisted = !!(await prisma.user.findUnique({ where: { username: 'admin' } }));
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@vapt.local',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      isActive: true,
      isForcePasswordChange: true,
    },
  });
  const adminCreated = !adminExisted;
  console.log('✅ Admin user ready:', admin.username);

  // Import vulnerabilities from JSON
  console.log('📊 Importing vulnerabilities from vulnerabilities.json...');
  const jsonPath = path.resolve(__dirname, 'vulnerabilities.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const vulnerabilities = JSON.parse(raw);

  let imported = 0;
  for (const vuln of vulnerabilities) {
    const existing = await prisma.vulnerability.findFirst({
      where: { name: vuln.name },
    });

    if (!existing) {
      await prisma.vulnerability.create({
        data: {
          name: vuln.name,
          severity: vuln.severity,
          cvssScore: vuln.cvssScore,
          cvssVector: vuln.cvssVector,
          description: vuln.description,
          impact: vuln.impact,
          remediation: vuln.remediation,
          references: vuln.references,
          source: 'imported',
        },
      });
      imported++;
    }
  }
  console.log(`✅ ${imported} vulnerabilities imported`);

  // Demo data (extra users with KNOWN passwords + sample projects/findings) is opt-in: SEED_DEMO=true
  if (process.env.SEED_DEMO === 'true') {
    // Create Team Lead
    const tlPassword = await argon2.hash('Tl@1234567890!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const tl = await prisma.user.upsert({
      where: { username: 'teamlead' },
      update: {},
      create: {
        username: 'teamlead',
        email: 'tl@vapt.local',
        passwordHash: tlPassword,
        role: UserRole.TEAM_LEAD,
        isActive: true,
        isForcePasswordChange: true,
      },
    });
    console.log('✅ Team Lead created:', tl.username);

    // Create Testers
    const testerPassword = await argon2.hash('Tester@1234567890!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const tester1 = await prisma.user.upsert({
      where: { username: 'tester1' },
      update: {},
      create: {
        username: 'tester1',
        email: 'tester1@vapt.local',
        passwordHash: testerPassword,
        role: UserRole.TESTER,
        assignedTlId: tl.id,
        isActive: true,
        isForcePasswordChange: true,
      },
    });

    const tester2 = await prisma.user.upsert({
      where: { username: 'tester2' },
      update: {},
      create: {
        username: 'tester2',
        email: 'tester2@vapt.local',
        passwordHash: testerPassword,
        role: UserRole.TESTER,
        assignedTlId: tl.id,
        isActive: true,
        isForcePasswordChange: true,
      },
    });
    console.log('✅ Testers created');

    // Create sample projects
    const project1 = await prisma.project.create({
      data: {
        name: 'E-Commerce Platform Assessment',
        clientName: 'TechCorp Inc.',
        scope: 'Web application, API, and mobile app',
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-02-15'),
        status: ProjectStatus.IN_PROGRESS,
        testerId: tester1.id,
        tlId: tl.id,
      },
    });

    const project2 = await prisma.project.create({
      data: {
        name: 'Banking Infrastructure Test',
        clientName: 'SecureBank Ltd.',
        scope: 'Network infrastructure and thick client',
        startDate: new Date('2024-02-01'),
        status: ProjectStatus.NOT_STARTED,
        testerId: tester2.id,
        tlId: tl.id,
      },
    });

    const project3 = await prisma.project.create({
      data: {
        name: 'Healthcare Portal Review',
        clientName: 'MediCare Systems',
        scope: 'Web portal and API endpoints',
        startDate: new Date('2023-12-01'),
        endDate: new Date('2024-01-10'),
        status: ProjectStatus.COMPLETED,
        testerId: tester1.id,
        tlId: tl.id,
      },
    });
    console.log('✅ Sample projects created');

    // Create findings for projects
    const vulns = await prisma.vulnerability.findMany();
  
    await prisma.finding.createMany({
      data: [
        {
          projectId: project1.id,
          vulnId: vulns[0]?.id || '',
          evidencePaths: ['screenshots/sql-injection-1.png', 'screenshots/sql-injection-2.png'],
          testerNotes: 'Confirmed SQL injection in the login form using sqlmap. Database: PostgreSQL 14.',
          status: FindingStatus.SUBMITTED,
          createdById: tester1.id,
          affectedInstances: ['https://app.example.com/login'],
          authenticationType: 'None',
          reportStatus: 'Open',
        },
        {
          projectId: project1.id,
          vulnId: vulns[1]?.id || '',
          evidencePaths: ['screenshots/xss-payload.png'],
          testerNotes: 'XSS confirmed with <script>alert(1)</script> payload in comment field.',
          status: FindingStatus.DRAFT,
          createdById: tester1.id,
          affectedInstances: ['https://app.example.com/comments'],
          authenticationType: 'Session',
          reportStatus: 'Open',
        },
        {
          projectId: project3.id,
          vulnId: vulns[4]?.id || '',
          evidencePaths: ['screenshots/weak-password.png'],
          testerNotes: 'Application accepts 6-character passwords. No complexity requirements enforced.',
          status: FindingStatus.APPROVED,
          createdById: tester1.id,
          affectedInstances: ['https://app.example.com/register'],
          authenticationType: 'None',
          reportStatus: 'Closed',
        },
      ],
    });
    console.log('✅ Sample findings created');
  }

  console.log('\n🎉 Seed completed successfully!');
  if (adminCreated && !process.env.ADMIN_PASSWORD) {
    console.log(`\nFirst login -> username: admin  password: ${adminPlain}  (you must change it on first login)`);
  }
  if (process.env.SEED_DEMO === 'true') {
    console.log('\nDemo users (insecure, demo only): teamlead / Tl@1234567890!, tester1 / Tester@1234567890!, tester2 / Tester@1234567890!');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
