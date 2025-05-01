const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');

function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let current = null;

  for (const el of body.children) {
    const text = el.textContent.trim();

    if (text.startsWith('\\question{')) {
      if (current) blocks.push(current);
      const id = text.match(/\\question\{(.*?)\}/)?.[1] || `q${blocks.length + 1}`;
      current = { type: 'question', id, content: '' };
    } else if (text.startsWith('\\textresponse')) {
      if (current) blocks.push(current);
      current = { type: 'textresponse', content: '' };
    } else if (text.startsWith('\\python')) {
      if (current) blocks.push(current);
      current = { type: 'code', language: 'python', content: '' };
    } else if (text.startsWith('\\feedbackprompt')) {
      if (current) blocks.push(current);
      current = { type: 'feedbackprompt', content: '' };
    } else if (text.startsWith('\\roles')) {
      if (current) blocks.push(current);
      current = { type: 'roles', content: '' };
    } else if (text.startsWith('\\')) {
      // Skip unknown commands
    } else {
      if (!current) current = { type: 'info', content: '' };
      current.content += el.outerHTML;
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

exports.createActivityInstance = async (req, res) => {
  const { activityName, courseId, userId } = req.body; // Add userId from frontend

  try {
    // 1. Find activity_id
    const [[activity]] = await db.query(
      `SELECT id FROM pogil_activities WHERE name = ?`,
      [activityName]
    );
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    // 2. Check for existing instance (group_number is NULL = general instance)
    const [[instance]] = await db.query(
      `SELECT id FROM activity_instances 
       WHERE activity_id = ? AND course_id = ? AND group_number IS NULL`,
      [activity.id, courseId]
    );

    // 3. If found, check roles (via activity_groups)
    if (instance) {
      const [[group]] = await db.query(
        `SELECT * FROM activity_groups WHERE activity_instance_id = ?`,
        [instance.id]
      );

      if (!group) {
        // ✅ Roles not assigned yet → allow any student to proceed
        return res.json({ instanceId: instance.id });
      }

      // ✅ Roles are assigned: check if user is in the group
      const roleEmails = [
        group.facilitator_email,
        group.spokesperson_email,
        group.analyst_email,
        group.qc_email
      ];

      // Check if instructor
      const [[course]] = await db.query(
        `SELECT instructor_id FROM courses WHERE id = ?`,
        [courseId]
      );

      if (roleEmails.includes(req.body.userEmail) || course?.instructor_id === userId) {
        return res.json({ instanceId: instance.id });
      } else {
        return res.status(403).json({ error: 'Not authorized to start this activity.' });
      }
    }

    // 4. No instance exists → create one
    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id, group_number) VALUES (?, ?, NULL)`,
      [activity.id, courseId]
    );

    res.json({ instanceId: result.insertId });

  } catch (err) {
    console.error("❌ Failed to create/use activity instance:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createActivityInstanceWithRoles = async (req, res) => {
  const { activityName, courseId, roles } = req.body;

  try {
    // 1. Look up activity ID
    const [[activity]] = await db.query(
      `SELECT id FROM pogil_activities WHERE name = ?`, [activityName]
    );

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    // 2. Create activity_instance
    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id) VALUES (?, ?)`,
      [activity.id, courseId]
    );

    const instanceId = result.insertId;

    // 3. Create 1 activity_group for this instance with group_number = 1
    const [groupResult] = await db.query(
      `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
      [instanceId, 1]
    );
    const groupId = groupResult.insertId;

    // 4. Insert group members (roles are passed as user IDs)
    const roleEntries = [
      ['facilitator', roles.facilitator],
      ['spokesperson', roles.spokesperson],
      ['analyst', roles.analyst],
      ['qc', roles.qc]
    ];

    for (const [role, studentId] of roleEntries) {
      await db.query(
        `INSERT INTO group_members (activity_group_id, student_id, role) VALUES (?, ?, ?)`,
        [groupId, studentId, role]
      );
    }

    res.json({ instanceId });
  } catch (err) {
    console.error("❌ Failed to create activity instance:", err);
    res.status(500).json({ error: "Failed to create activity instance" });
  }
};

exports.getActivityInstanceById = async (req, res) => {
  const { id } = req.params;
console.log("🔍 Instance ID:", id);
  try {
    const [[instance]] = await db.query(`
      SELECT ai.id, ai.course_id, a.name AS activity_name
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [id]);

    if (!instance) {
      return res.status(404).json({ error: "Instance not found" });
    }

    res.json(instance);
  } catch (err) {
    console.error("❌ Failed to fetch activity instance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// In activity_instances/controller.js
exports.getParsedSheetForInstance = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT a.sheet_url
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [id]);

    console.log("🧪 Raw query result:", rows);

    const row = rows[0];
    console.log("📄 Extracted row:", row);

    if (!row || !row.sheet_url) {
      console.warn("⚠️ Missing or empty sheet_url");
      return res.status(404).json({ error: 'No sheet_url found' });
    }

    console.log("✅ Found sheet_url:", row.sheet_url);
    const parsed = await parseGoogleSheet(row.sheet_url);
    res.json(parsed);
  } catch (err) {
    console.error("❌ Error fetching sheet preview:", err);
    res.status(500).json({ error: 'Internal error' });
  }
};

exports.setupGroupsForActivity = async (req, res) => {
  const { activityId, courseId, presentStudentIds } = req.body;

  if (!activityId || !courseId || !Array.isArray(presentStudentIds)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Create the main activity instance
    const [instanceResult] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id) VALUES (?, ?)`,
      [activityId, courseId]
    );
    const instanceId = instanceResult.insertId;

    // 2. Shuffle students and group them into groups of 4
    const shuffled = [...presentStudentIds].sort(() => Math.random() - 0.5);
    const groups = [];
    for (let i = 0; i < shuffled.length; i += 4) {
      groups.push(shuffled.slice(i, i + 4));
    }

    let groupNumber = 1;
    for (const group of groups) {
      const [groupResult] = await db.query(
        `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
        [instanceId, groupNumber]
      );
      const groupId = groupResult.insertId;

      const roles = ['facilitator', 'spokesperson', 'analyst', 'qc'];
      for (let i = 0; i < group.length; i++) {
        const studentId = group[i];
        if (!studentId) continue;

        await db.query(
          `INSERT INTO group_members (activity_group_id, student_id, role) VALUES (?, ?, ?)`,
          [groupId, studentId, roles[i]]
        );
      }

      groupNumber++;
    }

    res.status(201).json({ instanceId });
  } catch (err) {
    console.error('❌ Group setup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.setupGroupsForInstance = async (req, res) => {
  const { id: instanceId } = req.params;
  const { groups } = req.body;

// 🧹 Delete existing groups and their members first
const [existingGroups] = await db.query(
  `SELECT id FROM activity_groups WHERE activity_instance_id = ?`,
  [instanceId]
);

const groupIds = existingGroups.map(g => g.id);
if (groupIds.length > 0) {
  await db.query(
    `DELETE FROM group_members WHERE activity_group_id IN (?)`,
    [groupIds]
  );
  await db.query(
    `DELETE FROM activity_groups WHERE activity_instance_id = ?`,
    [instanceId]
  );
}

  // ✅ Validate group structure and size
  if (
    !Array.isArray(groups) ||
    groups.length === 0 ||
    groups.flatMap(g => g.members || []).length < 4
  ) {
    return res.status(400).json({ error: 'At least 4 students are required' });
  }

  try {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      // ✅ Provide group_number to satisfy UNIQUE(activity_instance_id, group_number)
      const [groupResult] = await db.query(
        `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
        [instanceId, i + 1]
      );

      const groupId = groupResult.insertId;

      // ✅ Insert group members
      for (const member of group.members) {
        await db.query(
          `INSERT INTO group_members (activity_group_id, student_id, role) VALUES (?, ?, ?)`,
          [groupId, member.student_id, member.role]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error setting up groups:', err);
    res.status(500).json({ error: 'Failed to set up groups' });
  }
};

exports.getEnrolledStudents = async (req, res) => {
  const { id } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT course_id FROM activity_instances WHERE id = ?`,
      [id]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    const [students] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [instance.course_id]
    );

      res.json({students});
  } catch (err) {
    console.error("❌ Failed to fetch enrolled students:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
};

// server/activity_instances/controller.js (add this route)

exports.recordHeartbeat = async (req, res) => {
  const { instanceId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    await db.query(
      `REPLACE INTO activity_heartbeats (activity_instance_id, user_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [instanceId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving heartbeat:", err);
    res.status(500).json({ error: 'Failed to record presence' });
  }
};


// GET /api/activity-instances/:instanceId/active-student
exports.getActiveStudent = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT ah.user_id, ah.updated_at
      FROM activity_heartbeats ah
      JOIN group_members gm ON ah.user_id = gm.student_id
      JOIN activity_groups ag ON gm.activity_group_id = ag.id
      WHERE ah.activity_instance_id = ?
        AND ah.updated_at >= NOW() - INTERVAL 60 SECOND
      ORDER BY ah.updated_at ASC
    `, [instanceId]);

    if (rows.length === 0) {
      return res.json({ activeStudentId: null });
    }

    const studentIds = [...new Set(rows.map(r => r.user_id))];
    const now = Date.now();
    const index = Math.floor(now / 60000) % studentIds.length;
    const activeStudentId = studentIds[index];

    res.json({ activeStudentId });
  } catch (err) {
    console.error("❌ Failed to determine active student:", err);
    res.status(500).json({ error: 'Failed to determine active student' });
  }
};

const { authorize } = require('../utils/googleAuth');

exports.getParsedActivityDoc = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT a.sheet_url
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [instanceId]);

    if (!rows.length || !rows[0].sheet_url) {
      return res.status(404).json({ error: 'No sheet_url found' });
    }

    const sheetUrl = rows[0].sheet_url;
    const docId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    if (!docId) throw new Error('Invalid sheet_url');

    const auth = authorize();
    const docs = google.docs({ version: 'v1', auth });
    const doc = await docs.documents.get({ documentId: docId });

    // Build a raw HTML string from the Google Doc
    const html = doc.data.body.content
      .map(block => {
        if (!block.paragraph?.elements) return null;

        const text = block.paragraph.elements
          .map(e => e.textRun?.content || '')
          .join('')
          .trim();

        return text.length > 0 ? `<p>${text}</p>` : null;
      })
      .filter(Boolean)
      .join('\n');

    // Parse it into structured blocks (already defined above)
    const blocks = parseGoogleDocHTML(html);
    res.json({ lines: blocks });
  } catch (err) {
    console.error("❌ Error parsing activity doc:", err);
    res.status(500).json({ error: 'Failed to load document' });
  }
};
