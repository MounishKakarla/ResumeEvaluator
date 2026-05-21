"""Database seed script.

Run with: docker-compose exec backend python seed.py

Creates:
- 1 admin user  (email from ADMIN_EMAIL env, password from ADMIN_PASSWORD env,
                  defaults: admin@company.com / admin123)
- 15 skills across 3 categories
- 1 job role: "Senior ML Engineer" (weights 50/30/20, threshold 0.30, min_exp 3)
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    from app.auth import hash_password
    from app.database import SessionLocal, create_db_tables
    from app.models import JobRole, JobRoleSkill, Skill, User

    create_db_tables()

    db = SessionLocal()
    try:
        # ------------------------------------------------------------------
        # Admin user
        # ------------------------------------------------------------------
        admin_email = os.environ.get("ADMIN_EMAIL", "")
        _env_hash = os.environ.get("ADMIN_HASHED_PASSWORD", "")
        _env_plain = os.environ.get("ADMIN_PASSWORD", "")

        if not admin_email:
            print(
                "WARNING: ADMIN_EMAIL is not set. "
                "Defaulting to admin@company.com — change this before deploying.",
                file=sys.stderr,
            )
            admin_email = "admin@company.com"

        if _env_hash:
            admin_hashed = _env_hash
        elif _env_plain:
            admin_hashed = hash_password(_env_plain)
        else:
            print(
                "WARNING: Neither ADMIN_PASSWORD nor ADMIN_HASHED_PASSWORD is set. "
                "Defaulting to a weak password. Set ADMIN_PASSWORD env var before deploying.",
                file=sys.stderr,
            )
            admin_hashed = hash_password("changeme123")

        existing_admin = db.query(User).filter(User.email == admin_email).first()
        if existing_admin is None:
            admin = User(
                email=admin_email,
                hashed_password=admin_hashed,
                role="admin",
            )
            db.add(admin)
            db.flush()
            print(f"Created admin user: {admin_email}")
        else:
            admin = existing_admin
            print(f"Admin user already exists: {admin_email}")

        # ------------------------------------------------------------------
        # Skills  (no embeddings needed — scorer uses TF-IDF on the fly)
        # ------------------------------------------------------------------
        skill_definitions = [
            ("Python",                "Backend"),
            ("FastAPI",               "Backend"),
            ("PostgreSQL",            "Backend"),
            ("Docker",                "Backend"),
            ("Redis",                 "Backend"),
            ("React",                 "Frontend"),
            ("TypeScript",            "Frontend"),
            ("Tailwind CSS",          "Frontend"),
            ("spaCy",                 "ML/AI"),
            ("scikit-learn",          "ML/AI"),
            ("PyTorch",               "ML/AI"),
            ("sentence-transformers", "ML/AI"),
            ("Kubernetes",            "Backend"),
            ("AWS",                   "Backend"),
            ("Git",                   "Backend"),
        ]

        skills_created: list[Skill] = []
        for skill_name, category in skill_definitions:
            existing = db.query(Skill).filter(Skill.name == skill_name).first()
            if existing is not None:
                skills_created.append(existing)
                continue

            skill = Skill(name=skill_name, category=category, embedding=None)
            db.add(skill)
            db.flush()
            skills_created.append(skill)
            print(f"  Created skill: {skill_name} [{category}]")

        # ------------------------------------------------------------------
        # Job role
        # ------------------------------------------------------------------
        role_title = "Senior ML Engineer"
        existing_role = db.query(JobRole).filter(JobRole.title == role_title).first()
        if existing_role is None:
            job_role = JobRole(
                title=role_title,
                min_experience=3,
                weight_projects=50,
                weight_skills=30,
                weight_education=20,
                cosine_threshold=0.30,   # TF-IDF scores are lower than embedding cosine
                created_by=admin.id,
            )
            db.add(job_role)
            db.flush()
            print(f"Created job role: {role_title}")

            for skill in skills_created:
                db.add(JobRoleSkill(
                    job_role_id=job_role.id,
                    skill_id=skill.id,
                    is_keyword=False,
                ))
            print(f"  Associated {len(skills_created)} skills with job role.")
        else:
            print(f"Job role already exists: {role_title}")

        db.commit()
        print("\nSeed completed successfully.")

    except Exception as exc:
        db.rollback()
        print(f"Seed failed: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
