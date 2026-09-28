import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import type { AgentPoolPerson } from "@/services/agent-pools";

interface AgentsAvatarStackProps {
  maxVisible?: number;
  people: AgentPoolPerson[];
}

export default function AgentsAvatarStack({
  maxVisible = 2,
  people,
}: AgentsAvatarStackProps) {
  const visiblePeople = people.slice(0, maxVisible);
  const remaining = Math.max(people.length - visiblePeople.length, 0);

  if (people.length === 0) return null;

  return (
    <AvatarGroup>
      {visiblePeople.map((person) => (
        <Avatar key={person.username} size="sm">
          <AvatarFallback className="bg-primary text-[9px] font-semibold text-primary-foreground">
            {person.avatarLabel}
            <span className="sr-only">{person.username}</span>
          </AvatarFallback>
        </Avatar>
      ))}
      {remaining > 0 ? (
        <AvatarGroupCount className="bg-muted text-[9px] font-bold text-foreground">
          +{remaining}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}
