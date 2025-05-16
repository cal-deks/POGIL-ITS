// src/pages/CourseActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Table, Button, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

console.log("📘 CourseActivitiesPage mounted");

export default function CourseActivitiesPage() {
  const { courseId, activityId } = useParams();
  console.log("courseId:", courseId, "activityId:", activityId); // ✅ should both be defined

  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useUser();

  useEffect(() => {
    console.log("📘 Fetching activities for courseId:", courseId);
    const fetchActivities = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/activities`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) {
          console.error("Expected array, got:", data);
          setActivities([]);
        } else {
          setActivities(data);
        }
      } catch (err) {
        console.error('❌ Failed to fetch activities:', err);
        setError('Unable to load activities.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [courseId]);

  useEffect(() => {
    console.log("Fetched activities:", activities);
  }, [activities]);

  const handleDoActivity = (activity, isInstructor = false) => {
    const activityId = activity.activity_id; // ✅ use the correct property
    console.log("🧠 FULL activity object:", activity);
    console.log("🔍 courseId:", courseId, "activityId:", activityId);
  
    const path = isInstructor
      ? `/setup-groups/${courseId}/${activityId}`
      : `/start/${courseId}/${activityId}`;
    navigate(path);
  };


  return (
    <Container className="mt-4">
      <h2>Available Activities</h2>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : activities.length === 0 ? (
        <Alert variant="info">No activities available for this course.</Alert>
      ) : (
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Activity Title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity, idx) => (
              <tr key={idx}>
                <td>{activity.title || activity.activity_name || 'Untitled Activity'}</td>

                <td>
                  {user.role === 'student' && activity.is_ready ? (
                    <Button
                      variant="success"
                      type="button"
                      onClick={() => handleDoActivity(activity)}
                    >
                      Start
                    </Button>

                  ) : (user.role === 'instructor' || user.role === 'root') ? (
                    <>
                      <Button
                        variant="primary"
                        className="me-2"
                        onClick={() => handleDoActivity(activity, true)}
                      >
                        Setup Groups
                      </Button>

                      {activity.instance_id && activity.is_ready && (
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/view-groups/${courseId}/${activity.instance_id}`)}
                        >
                          View Groups
                        </Button>
                      )}
                    </>
                  ) : (
                    <span>Not available</span>
                  )}
                </td>

              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
